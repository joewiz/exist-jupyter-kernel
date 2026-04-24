/**
 * Jupyter wire protocol implementation over ZeroMQ.
 *
 * Handles socket setup, message framing, HMAC signing, and
 * dispatching incoming messages to handler functions.
 *
 * Reference: https://jupyter-client.readthedocs.io/en/stable/messaging.html
 */

import * as zmq from "zeromq";
import { createHmac } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

const DELIMITER = "<IDS|MSG>";

/**
 * Parse a multipart ZeroMQ message into a Jupyter message object.
 */
export function parseMessage(frames, key) {
  // Find the delimiter
  let delimIdx = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].toString() === DELIMITER) {
      delimIdx = i;
      break;
    }
  }
  if (delimIdx === -1) {
    throw new Error("No delimiter found in message");
  }

  const idents = frames.slice(0, delimIdx);
  const hmacSignature = frames[delimIdx + 1].toString();
  const header = JSON.parse(frames[delimIdx + 2].toString());
  const parentHeader = JSON.parse(frames[delimIdx + 3].toString());
  const metadata = JSON.parse(frames[delimIdx + 4].toString());
  const content = JSON.parse(frames[delimIdx + 5].toString());

  // Verify HMAC if key is set
  if (key) {
    const hmac = createHmac("sha256", key);
    hmac.update(frames[delimIdx + 2].toString());
    hmac.update(frames[delimIdx + 3].toString());
    hmac.update(frames[delimIdx + 4].toString());
    hmac.update(frames[delimIdx + 5].toString());
    const expected = hmac.digest("hex");
    if (hmacSignature !== expected) {
      throw new Error("HMAC signature mismatch");
    }
  }

  return { idents, header, parentHeader, metadata, content };
}

/**
 * Build a multipart ZeroMQ message from a Jupyter message object.
 */
export function buildMessage(idents, header, parentHeader, metadata, content, key) {
  const headerStr = JSON.stringify(header);
  const parentStr = JSON.stringify(parentHeader);
  const metaStr = JSON.stringify(metadata);
  const contentStr = JSON.stringify(content);

  let hmacSignature = "";
  if (key) {
    const hmac = createHmac("sha256", key);
    hmac.update(headerStr);
    hmac.update(parentStr);
    hmac.update(metaStr);
    hmac.update(contentStr);
    hmacSignature = hmac.digest("hex");
  }

  return [
    ...idents,
    DELIMITER,
    hmacSignature,
    headerStr,
    parentStr,
    metaStr,
    contentStr,
  ];
}

/**
 * Create a new message header.
 */
export function makeHeader(msgType, session) {
  return {
    msg_id: uuidv4(),
    msg_type: msgType,
    session,
    username: "kernel",
    date: new Date().toISOString(),
    version: "5.3",
  };
}

/**
 * Send a message on a ZeroMQ socket.
 */
export async function sendMessage(socket, idents, msgType, content, parentHeader, session, key, metadata = {}) {
  const header = makeHeader(msgType, session);
  const frames = buildMessage(idents, header, parentHeader, metadata, content, key);
  await socket.send(frames);
  return header;
}

/**
 * Send a status message on the IOPub socket.
 */
export async function sendStatus(ioPub, status, parentHeader, session, key) {
  await sendMessage(ioPub, [], "status", { execution_state: status }, parentHeader, session, key);
}

/**
 * JupyterKernel — manages ZeroMQ sockets and message dispatch.
 */
export class JupyterKernel {
  constructor(connectionInfo, handlers) {
    this.connectionInfo = connectionInfo;
    this.handlers = handlers;
    this.session = uuidv4();
    this.key = connectionInfo.key || "";
    this.executionCount = 0;
  }

  _makeAddress(port) {
    const { transport, ip } = this.connectionInfo;
    return `${transport}://${ip}:${port}`;
  }

  async start() {
    const ci = this.connectionInfo;

    // Heartbeat — just echo back
    this.hbSocket = new zmq.Reply();
    await this.hbSocket.bind(this._makeAddress(ci.hb_port));

    // IOPub — publish outputs
    this.ioPubSocket = new zmq.Publisher();
    await this.ioPubSocket.bind(this._makeAddress(ci.iopub_port));

    // Control — control messages (shutdown, interrupt)
    this.controlSocket = new zmq.Router();
    await this.controlSocket.bind(this._makeAddress(ci.control_port));

    // Stdin — input requests (not used in Phase 1)
    this.stdinSocket = new zmq.Router();
    await this.stdinSocket.bind(this._makeAddress(ci.stdin_port));

    // Shell — main request/reply channel
    this.shellSocket = new zmq.Router();
    await this.shellSocket.bind(this._makeAddress(ci.shell_port));

    // Start listening
    this._listenHeartbeat();
    this._listenShell();
    this._listenControl();
  }

  async _listenHeartbeat() {
    for await (const [frame] of this.hbSocket) {
      await this.hbSocket.send(frame);
    }
  }

  async _listenShell() {
    for await (const frames of this.shellSocket) {
      try {
        const msg = parseMessage(frames, this.key);
        await this._handleShellMessage(msg);
      } catch (err) {
        console.error("Error handling shell message:", err);
      }
    }
  }

  async _listenControl() {
    for await (const frames of this.controlSocket) {
      try {
        const msg = parseMessage(frames, this.key);
        await this._handleControlMessage(msg);
      } catch (err) {
        console.error("Error handling control message:", err);
      }
    }
  }

  async _handleShellMessage(msg) {
    const { header, idents } = msg;

    // Publish busy status
    await sendStatus(this.ioPubSocket, "busy", header, this.session, this.key);

    try {
      switch (header.msg_type) {
        case "kernel_info_request":
          await this._handleKernelInfo(msg, idents);
          break;
        case "execute_request":
          await this._handleExecute(msg, idents);
          break;
        case "is_complete_request":
          await this._handleIsComplete(msg, idents);
          break;
        case "complete_request":
          await this._handleComplete(msg, idents);
          break;
        case "inspect_request":
          await this._handleInspect(msg, idents);
          break;
        default:
          console.log("Unhandled shell message:", header.msg_type);
      }
    } finally {
      // Publish idle status
      await sendStatus(this.ioPubSocket, "idle", header, this.session, this.key);
    }
  }

  async _handleControlMessage(msg) {
    const { header, idents } = msg;

    switch (header.msg_type) {
      case "shutdown_request": {
        const restart = msg.content.restart || false;
        await sendMessage(
          this.controlSocket, idents, "shutdown_reply",
          { status: "ok", restart },
          header, this.session, this.key
        );
        if (!restart) {
          process.exit(0);
        }
        break;
      }
      case "interrupt_request":
        await sendMessage(
          this.controlSocket, idents, "interrupt_reply",
          { status: "ok" },
          header, this.session, this.key
        );
        break;
      default:
        console.log("Unhandled control message:", header.msg_type);
    }
  }

  async _handleKernelInfo(msg, idents) {
    const reply = this.handlers.kernelInfo();
    await sendMessage(
      this.shellSocket, idents, "kernel_info_reply",
      reply, msg.header, this.session, this.key
    );
  }

  async _handleExecute(msg, idents) {
    this.executionCount++;
    const count = this.executionCount;

    // Publish execute_input on IOPub
    await sendMessage(
      this.ioPubSocket, [], "execute_input",
      { code: msg.content.code, execution_count: count },
      msg.header, this.session, this.key
    );

    try {
      const result = await this.handlers.execute(msg.content, count, msg.header.session);

      if (result.error) {
        // Publish error on IOPub
        await sendMessage(
          this.ioPubSocket, [], "error",
          {
            ename: result.ename || "ExecutionError",
            evalue: result.evalue || result.error,
            traceback: result.traceback || [],
          },
          msg.header, this.session, this.key
        );

        // Reply with error status
        await sendMessage(
          this.shellSocket, idents, "execute_reply",
          {
            status: "error",
            execution_count: count,
            ename: result.ename || "ExecutionError",
            evalue: result.evalue || result.error,
            traceback: result.traceback || [],
          },
          msg.header, this.session, this.key
        );
      } else {
        // Publish execute_result on IOPub
        if (result.data) {
          await sendMessage(
            this.ioPubSocket, [], "execute_result",
            {
              execution_count: count,
              data: result.data,
              metadata: result.metadata || {},
            },
            msg.header, this.session, this.key
          );
        }

        // Reply with ok status
        await sendMessage(
          this.shellSocket, idents, "execute_reply",
          {
            status: "ok",
            execution_count: count,
            user_expressions: {},
          },
          msg.header, this.session, this.key
        );
      }
    } catch (err) {
      const ename = "KernelError";
      const evalue = err.message;
      const traceback = [err.stack];

      await sendMessage(
        this.ioPubSocket, [], "error",
        { ename, evalue, traceback },
        msg.header, this.session, this.key
      );

      await sendMessage(
        this.shellSocket, idents, "execute_reply",
        { status: "error", execution_count: count, ename, evalue, traceback },
        msg.header, this.session, this.key
      );
    }
  }

  async _handleIsComplete(msg, idents) {
    const result = this.handlers.isComplete(msg.content.code);
    await sendMessage(
      this.shellSocket, idents, "is_complete_reply",
      result, msg.header, this.session, this.key
    );
  }

  async _handleComplete(msg, idents) {
    // Phase 1: no completions
    await sendMessage(
      this.shellSocket, idents, "complete_reply",
      { status: "ok", matches: [], cursor_start: msg.content.cursor_pos, cursor_end: msg.content.cursor_pos, metadata: {} },
      msg.header, this.session, this.key
    );
  }

  async _handleInspect(msg, idents) {
    // Phase 1: no inspection
    await sendMessage(
      this.shellSocket, idents, "inspect_reply",
      { status: "ok", found: false, data: {}, metadata: {} },
      msg.header, this.session, this.key
    );
  }

  async close() {
    for (const sock of [this.hbSocket, this.ioPubSocket, this.controlSocket, this.stdinSocket, this.shellSocket]) {
      if (sock) {
        try { sock.close(); } catch { /* ignore */ }
      }
    }
  }
}
