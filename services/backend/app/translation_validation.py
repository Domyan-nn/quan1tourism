"""Offline, independent language/copy checks shared by worker, API and audit.

These checks establish eligibility for HUMAN review, never semantic accuracy.
py3langid's bundled resource is loaded once; no downloads or model inference.
"""
from collections import Counter
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from functools import lru_cache
import re
from threading import Lock
import unicodedata

from .schemas import TranslationInput

VALIDATOR_VERSION = "translation-v2.1"
DETECTOR_VERSION = "py3langid-0.4.0-bundled-139"
# Regional/script variants remain distinct task codes. The detector only
# identifies the base language; script/region accuracy still needs review.
LANGUAGES = {
    "vi": "Vietnamese", "en": "English", "fr": "French", "de": "German",
    "es": "Spanish", "it": "Italian", "pt": "Portuguese", "id": "Indonesian",
    "ms": "Malay", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "th": "Thai", "hi": "Hindi",
}
ALIASES = {"zh-cn": "zh", "zh-tw": "zh", "zh-hans": "zh", "zh-hant": "zh",
           "pt-br": "pt", "pt-pt": "pt", "en-us": "en", "en-gb": "en",
           "vi-vn": "vi", "fr-fr": "fr", "de-de": "de", "es-es": "es",
           "it-it": "it", "id-id": "id", "ms-my": "ms", "ar-sa": "ar",
           "ru-ru": "ru", "th-th": "th", "ja-jp": "ja", "ko-kr": "ko"}
ERROR_CODES = frozenset({
    "source_copy", "wrong_language", "wrong_script", "language_uncertain",
    "empty_output", "invalid_output", "incomplete_generation", "repetitive_output",
    "damaged_unicode", "model_timeout", "worker_unavailable", "generation_failed",
    "source_changed", "target_changed", "batch_limited", "language_not_verified",
})
_DETECT_LOCK = Lock()


def language_code(code):
    value = (code or "").replace("_", "-").lower()
    return ALIASES.get(value, value if value in LANGUAGES else None)


def safe_error(code):
    return code if code in ERROR_CODES else "generation_failed"


@dataclass(frozen=True)
class ValidationConfig:
    min_letters: int = 24
    min_cjk_letters: int = 10
    language_confidence: float = 0.85
    confidence_margin: float = 0.20
    near_copy_ratio: float = 0.90
    copied_source_coverage: float = 0.65
    copied_output_coverage: float = 0.60
    min_copy_block: int = 50
    script_ratio: float = 0.45
    mixed_language_ratio: float = 0.20
    max_text_chars: int = 30000


@dataclass
class ValidationResult:
    status: str
    issues: list[str]
    metrics: dict
    validator_version: str = VALIDATOR_VERSION
    detector_version: str = DETECTOR_VERSION

    @property
    def passed(self):
        return self.status == "passed"

    def to_dict(self):
        return asdict(self)


def normalized(value):
    value = unicodedata.normalize("NFC", value).casefold()
    return " ".join("".join(c if c.isalnum() else " " for c in value).split())


@lru_cache(maxsize=1)
def detector():
    from py3langid.langid import LanguageIdentifier, MODEL_FILE

    # Keep ALL detector languages: restricting to source/target would force an
    # unrelated language into one of those choices. Malay != Indonesian, etc.
    return LanguageIdentifier.from_model_file(MODEL_FILE, norm_probs=True)


@lru_cache(maxsize=512)
def identify(value):
    with _DETECT_LOCK:
        ranked = detector().rank(value)
    return ranked[0][0], float(ranked[0][1]), float(ranked[0][1] - ranked[1][1])


def _letters(value):
    return sum(c.isalpha() for c in value)


def source_names(source):
    """Conservative capitalized name runs, only from the trusted source.

    Used for detection, never copy normalization or the stored translation.
    Lowercase prose and single sentence-initial words are not removed.
    """
    words = re.findall(r"[^\W\d_]+|[,.!?;:\n]", source, re.UNICODE)
    runs, current = [], []
    for word in words + ["."]:
        if word[0].isupper() and word.isalpha():
            current.append(word)
        else:
            if 2 <= len(current) <= 8:
                value = " ".join(current)
                if len(value) <= 70:
                    runs.append(value)
            current = []
    return runs


def validate_translation(source_text, source_locale, translation, target_locale, *,
                         task="translation", generation_complete=True, protected_terms=(), config=None):
    cfg = config or ValidationConfig()
    issues, metrics = [], {"target_locale": target_locale, "source_locale": source_locale,
                           "task": task, "generation_complete": generation_complete}
    try:
        output = translation if isinstance(translation, TranslationInput) else TranslationInput.model_validate(translation)
    except (ValueError, TypeError):
        return ValidationResult("rejected", ["invalid_output"], metrics)
    text, title = output.text.strip(), output.title.strip()
    if not text or not title:
        issues.append("empty_output")
    if not generation_complete:
        issues.append("incomplete_generation")
    if "\ufffd" in title + text or any(unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in title + text):
        issues.append("damaged_unicode")
    if len(text) > cfg.max_text_chars:
        issues.append("invalid_output")
    source, target = language_code(source_locale), language_code(target_locale)
    if source is None or target is None:
        issues.append("language_uncertain")
    src, dst = normalized(source_text or ""), normalized(text)
    metrics.update(source_chars=len(src), output_chars=len(dst), letters=_letters(text))
    if source != target and task in {"translation", "summary_translation"} and len(src) >= 30 and len(dst) >= 30:
        matcher = SequenceMatcher(None, src, dst, autojunk=False)
        blocks = [b.size for b in matcher.get_matching_blocks() if b.size >= cfg.min_copy_block]
        source_coverage, output_coverage = sum(blocks) / len(src), sum(blocks) / len(dst)
        metrics.update(copy_similarity=round(matcher.ratio(), 4),
                       source_copy_coverage=round(source_coverage, 4), output_copy_coverage=round(output_coverage, 4))
        if (src == dst or matcher.ratio() >= cfg.near_copy_ratio
                or source_coverage >= cfg.copied_source_coverage and output_coverage >= cfg.copied_output_coverage):
            issues.append("source_copy")
    sentences = [normalized(s) for s in re.split(r"[.!?。！？\n]+", text) if _letters(s) >= 20]
    counts = Counter(sentences)
    if len(sentences) >= 3 and max(counts.values(), default=0) >= 3:
        issues.append("repetitive_output")
    words = normalized(text).split()
    if len(words) >= 40 and len(set(words)) / len(words) < 0.18:
        issues.append("repetitive_output")
    # Length is a relative truncation signal, not proof of a valid translation.
    if task == "translation" and len(src) >= 200 and len(dst) < len(src) * (0.12 if target in {"zh", "ja"} else 0.22):
        issues.append("incomplete_generation")
    letters = [c for c in text if c.isalpha()]
    scripts = {"ar": ("ARABIC",), "zh": ("CJK",), "ja": ("CJK", "HIRAGANA", "KATAKANA"),
               "ko": ("HANGUL",), "ru": ("CYRILLIC",), "th": ("THAI",), "hi": ("DEVANAGARI",)}
    if target in scripts and letters:
        ratio = sum(any(s in unicodedata.name(c, "") for s in scripts[target]) for c in letters) / len(letters)
        metrics["target_script_ratio"] = round(ratio, 4)
        if ratio < cfg.script_ratio:
            issues.append("wrong_script")
    minimum = cfg.min_cjk_letters if target in {"zh", "ja", "ko"} else cfg.min_letters
    if len(letters) < minimum:
        issues.append("language_uncertain")
    elif target:
        # Names/addresses may legitimately remain unchanged, but cannot hide
        # copied prose: copy detection always runs on the original text above.
        detection_text = text
        for term in (*protected_terms, *source_names(source_text or "")):
            if isinstance(term, str) and len(term.strip()) >= 5:
                detection_text = detection_text.replace(term.strip(), " ")
        if _letters(detection_text) < minimum:
            issues.append("language_uncertain")
        else:
            try:
                detected, confidence, margin = identify(detection_text)
                metrics.update(detected_language=detected, language_confidence=round(confidence, 4),
                               confidence_margin=round(margin, 4), variant_review_required="-" in target_locale)
                confident = confidence >= cfg.language_confidence and margin >= cfg.confidence_margin
                if confident and detected != target:
                    issues.append("wrong_language")
                elif not confident:
                    issues.append("language_uncertain")
                # Check meaningful sentences/paragraphs independently to avoid
                # allowing a foreign sentence to mask a mostly wrong-language body.
                parts = [s for s in re.split(r"(?<=[.!?。！？])\s+|\n+", detection_text) if _letters(s) >= 45]
                wrong_letters, checked_letters = 0, 0
                for part in parts[:100]:
                    lang, conf, gap = identify(part)
                    checked_letters += _letters(part)
                    if lang != target and conf >= cfg.language_confidence and gap >= cfg.confidence_margin:
                        wrong_letters += _letters(part)
                mixed_ratio = wrong_letters / checked_letters if checked_letters else 0.0
                metrics["wrong_language_segment_ratio"] = round(mixed_ratio, 4)
                if mixed_ratio >= cfg.mixed_language_ratio:
                    issues.append("wrong_language")
            except (ImportError, OSError, ValueError):
                issues.append("language_uncertain")
                metrics["detector_available"] = False
    issues = list(dict.fromkeys(issues))
    fatal = [code for code in issues if code != "language_uncertain"]
    return ValidationResult("rejected" if fatal else "uncertain" if issues else "passed", issues, metrics)


def article_locale(article):
    from urllib.parse import urlsplit

    return article.get("source_locale") or (urlsplit(article.get("url", "")).hostname or "").split(".")[0]


def validate_draft_translations(article, translations):
    source_locale = article_locale(article)
    return {code: validate_translation(article.get("text", ""), source_locale, tr, code,
            task="narration" if language_code(code) == language_code(source_locale) else "summary_translation",
            protected_terms=(article.get("title", ""),)) for code, tr in translations.items()}
