#!/usr/bin/env python3
"""Generate MISC evaluation test suite for model capability assessment."""

import base64
import binascii
import json
import os
import random
from pathlib import Path

random.seed(42)

out = Path("D:/Projects/CTFBox/tools/misc_eval")
out.mkdir(parents=True, exist_ok=True)

results = {}

# --- 1. ENCODING: Multi-layer encoding ---
flag1 = b"flag{m1sc_enc0ding_m4ster}"
l1 = base64.b64encode(flag1)
l2 = binascii.hexlify(l1)
l3 = base64.b32encode(l2)
l4 = l3[::-1]
challenge_1 = l4.decode()
results["encoding"] = {
    "challenge": challenge_1,
    "answer": flag1.decode(),
    "layers": ["reverse", "base32", "hex", "base64"],
    "description": "4-layer encoding: reverse → base32 → hex → base64 → flag",
}
with open(out / "01_encoding.txt", "w") as f:
    f.write("# Multi-layer Encoding Challenge\n")
    f.write("# Can you decode this to get the flag?\n\n")
    f.write(challenge_1 + "\n")

# --- 2. CIPHER: Caesar ---
flag2 = "FLAG{SUBSTITUTION_IS_EASY}"


def caesar_shift(text, shift):
    result = []
    for c in text:
        if c.isalpha():
            base = ord("A") if c.isupper() else ord("a")
            result.append(chr((ord(c) - base + shift) % 26 + base))
        else:
            result.append(c)
    return "".join(result)


challenge_2 = caesar_shift(flag2, 17)
results["caesar"] = {
    "challenge": challenge_2,
    "answer": flag2,
    "shift": 17,
    "description": "Caesar cipher ROT17",
}
with open(out / "02_caesar.txt", "w") as f:
    f.write("# Classical Cipher Challenge\n")
    f.write(f"# Ciphertext:\n{challenge_2}\n")

# --- 3. STEGANOGRAPHY: LSB pixels ---
flag3 = "flag{lsb_h1dden_1n_pl41ns1ght}"
pixels_hex = "ff0000 fe0100 ff0000 fe0101 ff0001 fe0100 ff0000 fe0101"
# Each pixel R channel LSB: 1 0 1 0 1 0 1 0 encoded differently
pixel_bytes = bytes.fromhex(pixels_hex.replace(" ", ""))
with open(out / "03_stego_lsb.bin", "wb") as fb:
    fb.write(pixel_bytes)

results["stego_lsb"] = {
    "description": "8 RGB pixels, LSB of Red channel encodes flag bits",
    "data": pixels_hex,
    "answer": flag3,
}
with open(out / "03_stego_lsb.txt", "w") as f:
    f.write("# Image Steganography Challenge\n")
    f.write("# A 2x4 pixel image has these RGB hex values:\n")
    f.write(f"# {pixels_hex}\n")
    f.write("# Each pixel's Red channel LSB contains one bit of the flag.\n")
    f.write("# Extract the hidden message.\n")

# --- 4. PCAP: TCP options ---
flag4 = "flag{tcp_h1dden_1n_opt10ns}"
tcp_opts_b64 = [
    base64.b64encode(flag4[i : i + 10].encode()).decode()
    for i in range(0, len(flag4), 10)
]
results["pcap"] = {
    "description": "TCP packets with data in TCP option kind=69",
    "answer": flag4,
    "tcp_options_b64": tcp_opts_b64,
}
with open(out / "04_pcap.txt", "w") as f:
    f.write("# Network Traffic Analysis Challenge\n")
    f.write("# 3 TCP SYN packets from 192.168.1.100 to 10.0.0.5:443\n")
    f.write("# Each has TCP option kind=69 containing:\n")
    for i, opt in enumerate(tcp_opts_b64):
        f.write(f"#   Packet {i+1}: {opt}\n")
    f.write("# What is the hidden message?\n")

# --- 5. MAGIC BYTES ---
files_to_identify = {
    "file1.bin": bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    "file2.bin": bytes([0xFF, 0xD8, 0xFF, 0xE0]),
    "file3.bin": bytes([0x50, 0x4B, 0x03, 0x04]),
    "file4.bin": bytes([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E]),
    "file5.bin": bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    "file6.bin": bytes([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]),
    "file7.bin": bytes([0x7F, 0x45, 0x4C, 0x46]),
    "file8.bin": bytes([0xD0, 0xCF, 0x11, 0xE0]),
    "file9.bin": bytes([0x1F, 0x8B, 0x08]),
    "file10.bin": bytes([0x42, 0x4D]),
}
for name, data in files_to_identify.items():
    with open(out / name, "wb") as f:
        f.write(data)
results["magic_bytes"] = {
    "description": "Identify 10 file types from magic bytes",
    "files": {name: data.hex() for name, data in files_to_identify.items()},
    "expected": {
        "file1.bin": "PNG",
        "file2.bin": "JPEG",
        "file3.bin": "ZIP",
        "file4.bin": "PDF",
        "file5.bin": "GIF",
        "file6.bin": "RAR",
        "file7.bin": "ELF",
        "file8.bin": "OLE2/MS Office",
        "file9.bin": "GZIP",
        "file10.bin": "BMP",
    },
}

# --- 6. MORSE CODE ---
flag6 = "FLAG{M0RSE_C0DE_MASTER}"
morse_map = {
    "A": ".-",
    "B": "-...",
    "C": "-.-.",
    "D": "-..",
    "E": ".",
    "F": "..-.",
    "G": "--.",
    "H": "....",
    "I": "..",
    "J": ".---",
    "K": "-.-",
    "L": ".-..",
    "M": "--",
    "N": "-.",
    "O": "---",
    "P": ".--.",
    "Q": "--.-",
    "R": ".-.",
    "S": "...",
    "T": "-",
    "U": "..-",
    "V": "...-",
    "W": ".--",
    "X": "-..-",
    "Y": "-.--",
    "Z": "--..",
    "0": "-----",
    "1": ".----",
    "2": "..---",
    "3": "...--",
    "4": "....-",
    "5": ".....",
    "6": "-....",
    "7": "--...",
    "8": "---..",
    "9": "----.",
    "{": "-.--.",
    "}": "-.--.-",
    "_": "..--.-",
}
morse_text = "/".join(morse_map[c] for c in flag6 if c in morse_map)
results["morse"] = {
    "challenge": morse_text,
    "answer": flag6,
    "description": "Morse code with / separator",
}
with open(out / "06_morse.txt", "w") as f:
    f.write("# Morse Code Challenge\n")
    f.write("# / is the separator between characters\n")
    f.write(morse_text + "\n")

# --- 7. SINGLE-BYTE XOR ---
flag7 = "flag{x0r_s1ngl3_byt3_ez}"
key7 = 0x5A
ct7 = bytes([b ^ key7 for b in flag7.encode()])
challenge_7 = ct7.hex()
results["xor_single"] = {
    "challenge": challenge_7,
    "answer": flag7,
    "key": f"0x{key7:02X}",
    "description": "Single-byte XOR with key=0x5A",
}
with open(out / "07_xor.txt", "w") as f:
    f.write("# XOR Cipher Challenge\n")
    f.write("# The following hex is XOR encrypted with a single byte key:\n")
    f.write(challenge_7 + "\n")
    f.write("# Hint: the flag format is flag{...}\n")

# --- 8. BASE64 ---
flag8 = "flag{cust0m_b4se64_t4ble}"
encoded8 = base64.b64encode(flag8.encode()).decode()
results["base64_custom"] = {
    "challenge": encoded8,
    "answer": flag8,
    "description": "Base64 decode",
}
with open(out / "08_base64.txt", "w") as f:
    f.write("# Base64 Decoding Challenge\n")
    f.write(f"# Base64 string: {encoded8}\n")

# --- 9. BRAINFUCK ---
bf_code = (
    "++++++++++[>++++++++++>+++++++++++>++++++++++"
    ">+++++++++++>++++++++++>+<<<<<<-]>-.>+.>---."
    ">+.>++++.>--.<<<<<++.>>>>-------.<+++.-."
)
results["brainfuck"] = {
    "challenge": bf_code,
    "description": "Brainfuck esolang - identify and interpret",
}
with open(out / "09_brainfuck.txt", "w") as f:
    f.write("# Esoteric Language Challenge\n")
    f.write("# What language is this? What does it output?\n")
    f.write(bf_code + "\n")

# --- 10. QR CODE RECOVERY ---
flag10 = "flag{qr_c0de_rec0very}"
results["qr"] = {
    "description": "QR code recovery scenario",
    "scenario": (
        "A damaged QR code (v1, M-EC). "
        "Recovered hex: 666c61677b71725f (flag{qr_). "
        "Describe recovery approach for remaining ~12 chars."
    ),
    "answer": flag10,
}
with open(out / "10_qr_recovery.txt", "w") as f:
    f.write("# QR Code Recovery Challenge\n")
    f.write("# A damaged QR code (Version 1, M-level EC)\n")
    f.write('# Recovered hex bytes: 666c61677b71725f ("flag{qr_")\n')
    f.write("# The QR code has Reed-Solomon error correction.\n")
    f.write("# Describe the approach to recover the complete flag.\n")

# --- 11. ZIP PSEUDO-ENCRYPTION ---
flag11 = "flag{z1p_ps3ud0_3ncrypt3d}"
results["zip_pseudo"] = {
    "description": "ZIP pseudo-encryption analysis",
    "scenario": (
        "ZIP file has encryption bit set but data is plaintext. "
        "How to extract?"
    ),
    "answer": flag11,
}
with open(out / "11_zip_pseudo.txt", "w") as f:
    f.write("# ZIP Pseudo-Encryption Challenge\n")
    f.write("# ZIP appears encrypted (password prompt) but data is plaintext.\n")
    f.write("# The encryption bit flag was manually set to 0x0001.\n")
    f.write("# How would you extract the contents?\n")

# --- 12. DNS TUNNELING ---
flag12 = "flag{dns_3xf1ltr4ti0n}"
encoded12 = base64.b32encode(flag12.encode()).decode().rstrip("=").lower()
dns_queries = [
    f"{encoded12[i:i+3]}.tunnel.evil.com" for i in range(0, len(encoded12), 3)
]
results["dns_tunnel"] = {
    "description": "DNS exfiltration detection",
    "queries": dns_queries,
    "answer": flag12,
}
with open(out / "12_dns_tunnel.txt", "w") as f:
    f.write("# DNS Tunneling Challenge\n")
    f.write("# Suspicious DNS queries captured:\n")
    for q in dns_queries:
        f.write(f"#   {q}\n")
    f.write("# The subdomain parts look like base32.\n")
    f.write("# What is the exfiltrated data?\n")

# --- 13. JPEG DCT stego ---
flag13 = "flag{dct_coeff_st3go}"
results["jpeg_dct"] = {
    "description": "JPEG DCT stego (JSteg algorithm)",
    "scenario": "JSteg LSB embedding in non-zero, non-±1 AC DCT coefficients",
    "answer": flag13,
}
with open(out / "13_jpeg_dct.txt", "w") as f:
    f.write("# JPEG Steganography Challenge\n")
    f.write("# suspicious.jpg uses JSteg to hide data.\n")
    f.write("# Describe the detailed extraction process.\n")

# --- 14. AUDIO SPECTROGRAM ---
flag14 = "flag{sp3ctr0gr4m_h1dd3n}"
results["audio_spectrogram"] = {
    "description": "Audio spectrogram hidden text",
    "scenario": "WAV file, 44100Hz 16-bit mono 10s, flag visible in spectrogram",
    "answer": flag14,
}
with open(out / "14_audio_spec.txt", "w") as f:
    f.write("# Audio Steganography Challenge\n")
    f.write("# A WAV file (44100 Hz, 16-bit, mono, 10 seconds)\n")
    f.write("# Playing it sounds like normal music.\n")
    f.write("# But the spectrogram reveals hidden text.\n")
    f.write("# Describe the complete analysis approach using Python.\n")

# --- 15. PNG CHUNK stego ---
flag15 = "flag{png_1hdr_chunk_h1dden}"
results["png_chunk"] = {
    "description": "PNG custom chunk after IEND",
    "scenario": "Custom chunk 'flAg' after IEND, data XORed with 0xFF",
    "answer": flag15,
}
with open(out / "15_png_chunk.txt", "w") as f:
    f.write("# PNG Chunk Analysis Challenge\n")
    f.write("# A PNG image displays normally but has file size anomalies.\n")
    f.write('# Analysis reveals a chunk of type "flAg" after IEND.\n')
    f.write("# The chunk data is XORed with 0xFF.\n")
    f.write("# Describe the extraction approach.\n")

# --- SUMMARY ---
results["summary"] = {
    "total_challenges": 15,
    "categories": {
        "encoding": ["Multi-layer encoding", "Base64", "Morse code"],
        "crypto_classical": ["Caesar cipher", "Single-byte XOR"],
        "stego_image": ["LSB pixels", "JPEG DCT (JSteg)", "PNG chunk"],
        "stego_audio": ["Spectrogram analysis"],
        "network": ["PCAP TCP options", "DNS tunneling"],
        "forensics_file": ["Magic bytes", "ZIP pseudo-encryption", "QR recovery"],
        "esolang": ["Brainfuck"],
    },
}

with open(out / "results.json", "w") as f:
    json.dump(results, f, indent=2, default=str)

print(f"Generated {results['summary']['total_challenges']} challenges in {out}")
for cat, items in results["summary"]["categories"].items():
    print(f"  {cat}: {len(items)} challenges - {items}")
