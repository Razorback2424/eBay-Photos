from pathlib import Path

# Baseline JPEG tables from ITU T.81
LUMINANCE_QUANT_TABLE = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
]

# Standard Huffman tables for luminance DC and AC
DC_CODEWORDS = {
    0: "00",
    1: "010",
    2: "011",
    3: "100",
    4: "101",
    5: "110",
    6: "1110",
    7: "11110",
    8: "111110",
    9: "1111110",
    10: "11111110",
    11: "111111110",
}

AC_CODEWORDS = {
    0x00: "1010",  # EOB
    0xF0: "11111111001",  # ZRL (not used here)
    0x01: "00",
    0x02: "01",
    0x03: "100",
    0x04: "1011",
    0x05: "11010",
    0x06: "1111000",
    0x07: "11111000",
    0x08: "1111110110",
    0x09: "1111111110000010",
    0x0A: "1111111110000011",
}

def _emit_marker(marker: int) -> bytes:
    return bytes([0xFF, marker & 0xFF])


def _jfif_segment() -> bytes:
    data = bytearray()
    data.extend(_emit_marker(0xE0))
    data.extend((0x00, 0x10))  # length 16
    data.extend(b"JFIF\x00")
    data.extend((0x01, 0x01))  # version 1.01
    data.extend((0x00,))  # no density units
    data.extend((0x00, 0x01, 0x00, 0x01))  # aspect ratio
    data.extend((0x00, 0x00))  # no thumbnail
    return bytes(data)


def _dqt_segment() -> bytes:
    data = bytearray()
    data.extend(_emit_marker(0xDB))
    data.extend((0x00, 0x43))  # length 67
    data.append(0x00)  # table 0, 8-bit precision
    data.extend(LUMINANCE_QUANT_TABLE)
    return bytes(data)


def _sof0_segment(width: int, height: int) -> bytes:
    data = bytearray()
    data.extend(_emit_marker(0xC0))
    data.extend((0x00, 0x0B))  # length 11
    data.append(0x08)  # 8-bit precision
    data.extend(height.to_bytes(2, "big"))
    data.extend(width.to_bytes(2, "big"))
    data.append(0x01)  # components
    data.append(0x01)  # component id
    data.append(0x11)  # sampling factors 1x1
    data.append(0x00)  # quant table 0
    return bytes(data)


def _dht_segment() -> bytes:
    # Only luminance DC and AC tables
    data = bytearray()
    # DC
    data.extend(_emit_marker(0xC4))
    # Bits table for DC (from Annex K.3)
    dc_bits = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    dc_vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    length = 3 + len(dc_bits) + len(dc_vals)
    data.extend(length.to_bytes(2, "big"))
    data.append(0x00)  # table 0, DC
    data.extend(dc_bits)
    data.extend(dc_vals)
    # AC
    ac_bits = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
    ac_vals = [
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
        0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
        0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
        0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
        0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
        0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
        0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
        0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA,
    ]
    length = 3 + len(ac_bits) + len(ac_vals)
    data.extend(length.to_bytes(2, "big"))
    data.append(0x10)  # table 0, AC
    data.extend(ac_bits)
    data.extend(ac_vals)
    return bytes(data)


def _sos_segment() -> bytes:
    data = bytearray()
    data.extend(_emit_marker(0xDA))
    data.extend((0x00, 0x08))  # length 8
    data.append(0x01)  # components
    data.append(0x01)  # component id
    data.append(0x00)  # Huffman tables
    data.append(0x00)  # spectral selection start
    data.append(0x3F)  # spectral selection end
    data.append(0x00)  # successive approximation
    return bytes(data)


def _pack_bits(bitstring: str) -> bytes:
    out = bytearray()
    current = 0
    bit_count = 0
    for bit in bitstring:
        current = (current << 1) | (1 if bit == "1" else 0)
        bit_count += 1
        if bit_count == 8:
            out.append(current)
            if current == 0xFF:
                out.append(0x00)
            current = 0
            bit_count = 0
    if bit_count:
        current <<= (8 - bit_count)
        out.append(current)
        if current == 0xFF:
            out.append(0x00)
    return bytes(out)


def _encode_dc(dc_value: int) -> str:
    if dc_value == 0:
        return DC_CODEWORDS[0]
    abs_val = abs(dc_value)
    size = abs_val.bit_length()
    amplitude = abs_val if dc_value > 0 else ((1 << size) - 1 + dc_value)
    amplitude_bits = format(amplitude, f"0{size}b") if size else ""
    return DC_CODEWORDS[size] + amplitude_bits

def generate_grayscale_jpeg(value: int, path: Path) -> None:
    if not 0 <= value <= 255:
        raise ValueError("Pixel value must be between 0 and 255")
    dc_coeff = round(0.5 * (value - 128))
    entropy_bits = _encode_dc(dc_coeff)
    entropy_bits += AC_CODEWORDS[0x00]  # EOB
    entropy_data = _pack_bits(entropy_bits)

    jpeg = bytearray()
    jpeg.extend(_emit_marker(0xD8))  # SOI
    jpeg.extend(_jfif_segment())
    jpeg.extend(_dqt_segment())
    jpeg.extend(_sof0_segment(8, 8))
    jpeg.extend(_dht_segment())
    jpeg.extend(_sos_segment())
    jpeg.extend(entropy_data)
    jpeg.extend(_emit_marker(0xD9))  # EOI

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(jpeg)

def main():
    output_root = Path(__file__).resolve().parent
    scenarios = {
        "controlled": {
            "description": "Even lighting, single card per frame.",
            "values": [180, 200, 220, 160],
            "prefix": "cardA"
        },
        "low_light": {
            "description": "Warm light bias, introduces darker tones.",
            "values": [90, 110, 130, 70],
            "prefix": "cardB"
        },
        "mixed_background": {
            "description": "Mixed cards per image simulating clutter.",
            "values": [140, 150, 190, 100, 210],
            "prefix": "cardC"
        }
    }

    for folder, config in scenarios.items():
        scenario_dir = output_root / "jpg" / folder
        scenario_dir.mkdir(parents=True, exist_ok=True)
        for index, val in enumerate(config["values"], start=1):
            filename = f"{config['prefix']}_shot{index:02d}.jpg"
            generate_grayscale_jpeg(val, scenario_dir / filename)

    notes_path = output_root / "README.md"
    if not notes_path.exists():
        notes_path.write_text(
            "# QA image assets\n\n"
            "Synthetic grayscale JPEGs are generated for deterministic export testing.\n"
            "Values vary to emulate different lighting intensities.\n"
            "Run `python generate_test_images.py` to recreate the assets.\n"
        )


if __name__ == "__main__":
    main()
