#!/usr/bin/env python3
"""
Integration test: start the XQuery kernel via jupyter_client,
execute cells, and verify results.
"""

import sys
import time
from jupyter_client import KernelManager

def test_kernel():
    km = KernelManager(kernel_name="xquery-exist")
    km.start_kernel()
    kc = km.client()
    kc.start_channels()

    # Wait for kernel to be ready
    try:
        kc.wait_for_ready(timeout=10)
        print("✓ Kernel is ready")
    except Exception as e:
        print(f"✗ Kernel failed to start: {e}")
        km.shutdown_kernel()
        sys.exit(1)

    # Test 1: kernel_info
    msg = kc.kernel_info()
    reply = kc.get_shell_msg(timeout=10)
    info = reply["content"]
    assert info["status"] == "ok", f"kernel_info failed: {info}"
    assert info["language_info"]["name"] == "xquery", f"Expected xquery, got {info['language_info']['name']}"
    print(f"✓ kernel_info: language={info['language_info']['name']}, version={info['language_info']['version']}")

    # Test 2: simple expression
    mid = kc.execute("1 + 1")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok", f"execute failed: {reply['content']}"
    result = _get_result(kc, msg_id=mid)
    assert result is not None, "No execute_result received"
    assert result["data"]["text/plain"] == "2", f"Expected '2', got '{result['data']['text/plain']}'"
    print(f"✓ Execute '1 + 1' = {result['data']['text/plain']}")

    # Test 3: XQuery FLWOR
    mid = kc.execute("for $x in (1, 2, 3) return $x * 10")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok"
    result = _get_result(kc, msg_id=mid)
    assert result is not None
    print(f"✓ FLWOR result: {result['data']['text/plain']}")

    # Test 4: XQuery error
    mid = kc.execute("this is not valid xquery !!!")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "error", "Expected error status"
    print(f"✓ Error handling: {reply['content']['ename']} — {reply['content']['evalue'][:60]}")

    # Test 5: is_complete
    mid = kc.is_complete("for $x in (")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "incomplete"
    print(f"✓ is_complete('for $x in ('): {reply['content']['status']}")

    mid = kc.is_complete("1 + 2")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "complete"
    print(f"✓ is_complete('1 + 2'): {reply['content']['status']}")

    # Test 6: XML construction
    mid = kc.execute("element greeting { 'Hello, Jupyter!' }")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok", f"XML construction failed: {reply['content']}"
    result = _get_result(kc, msg_id=mid)
    assert result is not None, "No execute_result for XML construction"
    print(f"✓ XML construction: {result['data']['text/plain']}")

    # Test 7: xqdoc @output serialization directive
    mid = kc.execute("(:~ @output method=xml indent=yes :)\n<root><child>text</child></root>")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok", f"xqdoc directive failed: {reply['content']}"
    result = _get_result(kc, msg_id=mid)
    assert result is not None, "No execute_result for xqdoc directive"
    # With indent=yes, the output should have newlines/indentation
    output = result["data"]["text/plain"]
    assert "\n" in output, f"Expected indented XML but got: {output}"
    print(f"✓ xqdoc @output indent=yes:\n{output}")

    # Test 8: HTML rendered via media-type=text/html
    mid = kc.execute("(:~ @output method=html media-type=text/html :)\n<h1>Hello</h1>")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok", f"HTML render failed: {reply['content']}"
    result = _get_result(kc, msg_id=mid)
    assert result is not None
    assert "text/html" in result["data"], f"Expected text/html in MIME bundle, got: {list(result['data'].keys())}"
    assert "<h1>Hello</h1>" in result["data"]["text/html"]
    print(f"✓ HTML rendered (media-type=text/html): {result['data']['text/html'][:40]}")

    # Test 9: HTML source (no media-type)
    mid = kc.execute("(:~ @output method=html :)\n<h1>Hello</h1>")
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok"
    result = _get_result(kc, msg_id=mid)
    assert result is not None
    assert "text/markdown" in result["data"], f"Expected text/markdown for source mode"
    assert "```html" in result["data"]["text/markdown"]
    print(f"✓ HTML source (no media-type): code fence present")

    # Test 10: CSV rendered as table via media-type=text/html
    mid = kc.execute('(:~ @output method=csv media-type=text/html :)\nstring-join(("name,age", "Alice,30", "Bob,25"), "&#10;")')
    reply = kc.get_shell_msg(timeout=10)
    assert reply["content"]["status"] == "ok", f"CSV render failed: {reply['content']}"
    result = _get_result(kc, msg_id=mid)
    assert result is not None
    assert "text/html" in result["data"], f"Expected text/html for CSV table"
    assert "<table" in result["data"]["text/html"]
    assert "Alice" in result["data"]["text/html"]
    print(f"✓ CSV table (media-type=text/html): {result['data']['text/html'][:60]}...")

    print("\n✓ All tests passed!")

    kc.stop_channels()
    km.shutdown_kernel()


def _get_result(kc, msg_id=None):
    """Drain IOPub until we find execute_result or error for this msg_id, or timeout."""
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            msg = kc.get_iopub_msg(timeout=2)
            # Skip messages from other requests
            parent_id = msg.get("parent_header", {}).get("msg_id")
            if msg_id and parent_id and parent_id != msg_id:
                continue
            if msg["msg_type"] == "execute_result":
                return msg["content"]
            if msg["msg_type"] == "error":
                return None
        except Exception:
            break
    return None


if __name__ == "__main__":
    test_kernel()
