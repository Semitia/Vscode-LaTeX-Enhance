"""Generate a small PDF fixture containing only synthetic test text."""
from pathlib import Path
lines = [
    'Companion reading test document',
    'This synthetic document contains selectable text.',
    'Translation appears beside the selected words.',
    'The reader can adjust the zoom with a slider.',
    'Keyboard controls preserve ordinary editing behavior.',
    'Selections can be attached to a research conversation.',
    'The first paragraph provides a simple testing example.',
    'The second paragraph demonstrates another sentence.',
    'Mathematical research needs precise terminology.',
    'Different services may produce different translations.',
    'An earlier selection should not replace a newer result.',
    'The latest selected sentence should remain visible.',
    'Escape closes the translation popup.',
    'Repeated text can reuse the translation cache.',
    'This document contains no private manuscript content.',
]
stream = 'BT /F1 12 Tf 50 750 Td 26 TL\n' + '\n'.join(f'({line}) Tj T*' for line in lines) + '\nET\n'
objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    f'<< /Length {len(stream.encode())} >>\nstream\n{stream}endstream',
]
content = bytearray(b'%PDF-1.4\n'); offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(content)); content.extend(f'{i} 0 obj\n{obj}\nendobj\n'.encode())
xref = len(content)
content.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]: content.extend(f'{offset:010d} 00000 n \n'.encode())
content.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
(Path(__file__).resolve().parents[1] / 'tests/fixtures/reading-sample.pdf').write_bytes(content)
