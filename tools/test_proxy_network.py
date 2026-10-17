"""以真正 POSIX shell／awk 驗證代理網路啟動腳本；不接觸 Docker、密碼或正式設定。
Linux: python3 tools/test_proxy_network.py
Windows（已安裝 WSL /bin/sh）: python tools/test_proxy_network.py
"""
import os
from pathlib import Path
import shlex
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / 'deployment/25-trusted-proxies.sh').read_text(encoding='utf-8')
SHELL = ['wsl.exe', '--exec', '/bin/sh', '-s'] if os.name == 'nt' else ['/bin/sh', '-s']
DEFAULT = 'default via 172.25.0.1 dev eth1\n'
CONNECTED = '172.25.0.0/16 dev eth1 proto kernel scope link src 172.25.0.9\n'
INTERNAL = '172.26.0.0/16 dev eth0 proto kernel scope link src 172.26.0.8\n'


def execute(source):
    # Windows text-mode stdin 會把 LF 改為 CRLF；Linux shell 必須接收原始 UTF-8 bytes。
    result = subprocess.run(SHELL, input=source.encode('utf-8'), capture_output=True)
    result.stdout = result.stdout.decode('utf-8', errors='replace')
    result.stderr = result.stderr.decode('utf-8', errors='replace')
    return result


def run(routes4, routes6='', fail=False):
    stub = 'ip() {\n'
    if fail:
        stub += 'return 1\n'
    else:
        stub += 'case "$1" in\n-4) printf "%s\\n" ' + shlex.quote(routes4) + ';;\n'
        stub += '-6) printf "%s\\n" ' + shlex.quote(routes6) + ';;\n*) return 1;;\nesac\n'
    stub += '}\nset -- --print\n'
    return execute(stub + SCRIPT)


class ProxyNetworkTests(unittest.TestCase):
    def test_private_gateway_only(self):
        r = run(DEFAULT + CONNECTED + INTERNAL)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('set_real_ip_from 172.25.0.0/16;', r.stdout)
        self.assertNotIn('172.26.', r.stdout)

    def test_busybox_route_without_proto_kernel(self):
        # Alpine BusyBox ip 不輸出 proto kernel；保留同一個 gateway／scope link 邊界。
        routes = (DEFAULT + CONNECTED + INTERNAL).replace('proto kernel ', '')
        r = run(routes, 'fd12:3456::/64 dev eth1 metric 256\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('set_real_ip_from 172.25.0.0/16;', r.stdout)
        self.assertIn('set_real_ip_from fd12:3456::/64;', r.stdout)
        self.assertNotIn('172.26.', r.stdout)

    def test_dynamic_connector_and_web_ip(self):
        first = run(DEFAULT + CONNECTED)
        second = run(DEFAULT + CONNECTED.replace('172.25.0.9', '172.25.3.200'))
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(second.returncode, 0, second.stderr)

    def test_network_recreated(self):
        r = run((DEFAULT + CONNECTED).replace('172.25.', '192.168.').replace('/16', '/24'))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('192.168.0.0/24;', r.stdout)
        self.assertNotIn('172.25.', r.stdout)

    def test_ipv6_ula_and_no_internal_trust(self):
        r = run(DEFAULT + CONNECTED + INTERNAL, 'fd12:3456::/64 dev eth1 proto kernel metric 256\nfd99::/64 dev eth0 proto kernel\nfe80::/64 dev eth1 proto kernel\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('fd12:3456::/64;', r.stdout)
        self.assertNotIn('fd99', r.stdout)
        self.assertNotIn('fe80', r.stdout)

    def test_busybox_rejects_routed_and_non_link_networks(self):
        routes = (DEFAULT + CONNECTED + INTERNAL).replace('proto kernel ', '')
        routes += '10.8.0.0/16 via 172.25.0.2 dev eth1 scope link\n'
        r = run(routes)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('10.8.', r.stdout)
        missing_link = run((DEFAULT + CONNECTED).replace('proto kernel ', '').replace('scope link ', ''))
        self.assertNotEqual(missing_link.returncode, 0)

    def test_missing_or_ambiguous_gateway(self):
        for routes in [CONNECTED, DEFAULT + 'default via 172.26.0.1 dev eth0\n' + CONNECTED + INTERNAL]:
            self.assertNotEqual(run(routes).returncode, 0)

    def test_no_connected_subnet(self):
        self.assertNotEqual(run(DEFAULT + INTERNAL).returncode, 0)

    def test_reject_public_overbroad_and_injection(self):
        for cidr in ['0.0.0.0/0', '10.0.0.0/0', '172.0.0.0/8', '192.168.0.0/8', '8.8.8.0/24', '172.25.999.0/24', '172.25.0.0/16;include', '172.25.0.0/33']:
            r = run(DEFAULT + CONNECTED.replace('172.25.0.0/16', cidr))
            self.assertNotEqual(r.returncode, 0, cidr)
            self.assertNotIn('set_real_ip_from', r.stdout)

    def test_reject_public_ipv6(self):
        r = run(DEFAULT + CONNECTED, '2001:db8::/32 dev eth1 proto kernel\n')
        self.assertNotEqual(r.returncode, 0)

    def test_ip_command_failure(self):
        self.assertNotEqual(run('', fail=True).returncode, 0)

    def test_routed_remote_subnet_not_trusted(self):
        r = run(DEFAULT + CONNECTED + '10.8.0.0/16 via 172.25.0.2 dev eth1 proto kernel scope link\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn('10.8.', r.stdout)

    def test_syntax_and_lf(self):
        self.assertFalse(SCRIPT.startswith('\ufeff'))
        self.assertNotIn(b'\r', (ROOT / 'deployment/25-trusted-proxies.sh').read_bytes())
        r = execute('set -n\n' + SCRIPT)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()
