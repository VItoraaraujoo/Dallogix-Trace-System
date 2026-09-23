#!/usr/bin/env python3
"""Valida o transporte Modbus TCP do CLP virtual sem tocar em hardware."""
from __future__ import annotations
import os
import socket
import struct
import ipaddress
import sys

HOST = os.getenv("MODBUS_TEST_HOST", "127.0.0.1")
PORT = int(os.getenv("MODBUS_TEST_PORT", "1502"))
UNIT = int(os.getenv("MODBUS_TEST_UNIT", "1"))

def receive_exact(sock: socket.socket, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise RuntimeError("resposta Modbus incompleta")
        data.extend(chunk)
    return bytes(data)

def request(sock: socket.socket, transaction: int, function: int, payload: bytes) -> bytes:
    frame = struct.pack(">HHHB", transaction, 0, len(payload) + 2, UNIT)
    sock.sendall(frame + bytes([function]) + payload)
    header = receive_exact(sock, 7)
    received_transaction, protocol, length, unit = struct.unpack(">HHHB", header)
    if length < 2 or length > 254:
        raise RuntimeError("comprimento Modbus inválido")
    body = receive_exact(sock, length - 1)
    if received_transaction != transaction or protocol != 0 or unit != UNIT:
        raise RuntimeError("cabeçalho Modbus inválido")
    if not body or body[0] != function:
        if body and body[0] == (function | 0x80):
            raise RuntimeError(f"exceção Modbus {body[1] if len(body) > 1 else '?'}")
        raise RuntimeError("função Modbus inesperada")
    return body

def main() -> None:
    write = sys.argv[1:] == ["--write-simulator"]
    if sys.argv[1:] and not write:
        raise SystemExit("Uso: test_modbus_virtual.py [--write-simulator]")
    if write:
        addresses = socket.getaddrinfo(HOST, PORT, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_loopback for item in addresses):
            raise SystemExit("Escrita de teste permitida somente no simulador em loopback.")
    with socket.create_connection((HOST, PORT), timeout=3) as connection:
        connection.settimeout(3)
        if write:
            request(connection, 1, 6, struct.pack(">HH", 0, 1234))
        holding = request(connection, 2, 3, struct.pack(">HH", 0, 1))
        if len(holding) != 4 or holding[1] != 2:
            raise RuntimeError("resposta do registrador inválida")
        if write and struct.unpack(">H", holding[2:4])[0] != 1234:
            raise RuntimeError("holding[0] não preservou a escrita")
        if write:
            request(connection, 3, 5, struct.pack(">HH", 0, 0xFF00))
            coil = request(connection, 4, 1, struct.pack(">HH", 0, 1))
            if len(coil) != 3 or coil[1] != 1 or not (coil[2] & 1):
                raise RuntimeError("coil[0] não preservou a escrita")
    print(f"OK: Modbus TCP {HOST}:{PORT} " + ("leu e escreveu o simulador." if write else "respondeu à leitura."))

if __name__ == "__main__":
    main()
