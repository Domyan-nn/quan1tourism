"""Report false accepts, rejects and abstentions on the labeled synthetic corpus."""
import argparse
from collections import Counter
from dataclasses import asdict
import json
from pathlib import Path
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/backend'))
from app.translation_validation import ValidationConfig, VALIDATOR_VERSION, validate_translation  # noqa: E402


def calibration(corpus):
    source = corpus['sources'][0]['text']
    cases = []
    for code, text in corpus['language_samples'].items():
        cases.append((f'valid-{code}', True, source, code, text, 'narration'))
    names = corpus['sources'][1]['text']
    french = ('Le centre culturel se trouve près de Phạm Ngọc Thạch, Nguyễn Văn Chiêm et Hai Bà Trưng. '
              'Les visiteurs peuvent y découvrir une cour et une salle communautaire. '
              'Un panneau présente les noms Dinh Độc Lập, Bưu điện Trung tâm et Bến Bạch Đằng comme références.')
    cases.extend([
        ('valid-names-fr', True, names, 'fr', french, 'translation'),
        ('valid-short-en', True, 'Xin chào mọi người, hôm nay chúng ta đi dạo trong công viên.', 'en',
         'Hello everyone, today we will take a walk in the park.', 'translation'),
    ])
    for code in ['fr', 'de', 'es', 'it', 'pt', 'id', 'ar']:
        for label, text in (
            ('exact', source), ('near', source.replace('Công viên', 'Khuôn viên', 1)),
            ('punctuation-nfd', unicodedata.normalize('NFD', source.upper().replace(' ', '\n ').replace('.', ' ! '))),
            ('foreign-intro', corpus['language_samples']['fr'][:65] + '\n' + source),
        ):
            cases.append((f'invalid-{code}-{label}', False, source, code, text, 'translation'))
    rows = []
    for label, valid, src, code, out, task in cases:
        result = validate_translation(src, 'vi', {'title': 'Narration', 'text': out}, code, task=task)
        rows.append({'label': label, 'expected_valid': valid, **result.to_dict()})
    counts = Counter(('valid' if r['expected_valid'] else 'invalid', r['status']) for r in rows)
    return {'validator_version': VALIDATOR_VERSION, 'thresholds': asdict(ValidationConfig()),
            'dataset': corpus['version'], 'dataset_purpose': 'development calibration, not an independent population estimate',
            'false_accepts': sum(not r['expected_valid'] and r['status'] == 'passed' for r in rows),
            'false_rejections': sum(r['expected_valid'] and r['status'] == 'rejected' for r in rows),
            'valid_uncertain': sum(r['expected_valid'] and r['status'] == 'uncertain' for r in rows),
            'counts': {a + ':' + b: n for (a, b), n in sorted(counts.items())}, 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/translation-calibration.json')
    args = parser.parse_args()
    corpus = json.loads((ROOT / 'tests/fixtures/translation-corpus.json').read_text(encoding='utf-8'))
    report = calibration(corpus)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('counts', 'false_accepts', 'false_rejections', 'valid_uncertain')}))


if __name__ == '__main__':
    main()
