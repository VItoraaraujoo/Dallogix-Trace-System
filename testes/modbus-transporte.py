"""Regressões com servidor descartável em loopback; nunca acessa o CLP real."""
import importlib.util
from pathlib import Path
import socket
import struct
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("modbus_virtual", ROOT / "integracoes/modbus-virtual/server.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


def receive(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise EOFError("conexão encerrada antes do frame completo")
        data += chunk
    return data


class ModbusTransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = server_module.ReusableServer(("127.0.0.1", 0), server_module.ModbusHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, function, payload, fragmented=False):
        frame = struct.pack(">HHHB", 42, 0, len(payload) + 2, 1) + bytes([function]) + payload
        with socket.create_connection(self.server.server_address, timeout=1) as sock:
            if fragmented:
                for chunk in (frame[:2], frame[2:7], frame[7:9], frame[9:]):
                    sock.sendall(chunk)
                    time.sleep(0.02)
            else:
                sock.sendall(frame)
            header = receive(sock, 7)
            tx, protocol, length, unit = struct.unpack(">HHHB", header)
            self.assertEqual((tx, protocol, unit), (42, 0, 1))
            return receive(sock, length - 1)

    def test_read_fragmented_tcp(self):
        self.assertEqual(self.request(3, struct.pack(">HH", 0, 1), True), b"\x03\x02\x00\x00")

    def test_unsupported_function(self):
        self.assertEqual(self.request(65, b""), b"\xc1\x01")

    def test_invalid_address(self):
        self.assertEqual(self.request(3, struct.pack(">HH", 64, 1)), b"\x83\x02")

    def test_invalid_quantity(self):
        self.assertEqual(self.request(3, struct.pack(">HH", 0, 0)), b"\x83\x03")


if __name__ == "__main__":
    unittest.main()
