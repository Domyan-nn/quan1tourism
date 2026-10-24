import json
from pathlib import Path
import unicodedata

import pytest

from app.translation_validation import language_code, validate_translation, validate_draft_translations

CORPUS = json.loads((Path(__file__).parents[3] / 'tests/fixtures/translation-corpus.json').read_text(encoding='utf-8'))
SOURCE = CORPUS['sources'][0]['text']


@pytest.mark.parametrize('locale', list(CORPUS['language_samples']))
def test_labeled_language_samples(locale):
    result = validate_translation(SOURCE, 'vi', {'title': 'Park', 'text': CORPUS['language_samples'][locale]},
                                  locale, task='narration')
    if locale in {'id', 'ms'}:
        assert result.status in {'passed', 'uncertain'}, result.to_dict()
    else:
        assert result.passed, result.to_dict()


@pytest.mark.parametrize('locale', ['fr', 'de', 'es', 'it', 'pt', 'id', 'ar'])
@pytest.mark.parametrize('transform', ['exact', 'punctuation', 'near', 'foreign_sentence'])
def test_copied_source_never_passes(locale, transform):
    text = SOURCE
    if transform == 'punctuation':
        text = unicodedata.normalize('NFD', SOURCE.upper().replace(' ', '\n  ').replace('.', ' ! '))
    elif transform == 'near':
        text = SOURCE.replace('Công viên', 'Khuôn viên', 1)
    elif transform == 'foreign_sentence':
        text = CORPUS['language_samples']['fr'][:65] + '\n' + SOURCE
    result = validate_translation(SOURCE, 'vi', {'title': 'Titre', 'text': text}, locale)
    assert not result.passed and 'source_copy' in result.issues


def test_names_short_text_same_language_and_mixed_text():
    source = CORPUS['sources'][1]['text']
    french = ('Le centre culturel se trouve près de Phạm Ngọc Thạch, Nguyễn Văn Chiêm et Hai Bà Trưng. '
              'Les visiteurs peuvent y découvrir une cour et une salle communautaire. '
              'Un panneau présente les noms Dinh Độc Lập, Bưu điện Trung tâm et Bến Bạch Đằng comme références.')
    assert validate_translation(source, 'vi', {'title': 'Centre culturel', 'text': french}, 'fr').passed
    short = validate_translation('Xin chào mọi người, hôm nay chúng ta đi dạo trong công viên.', 'vi',
        {'title': 'Welcome', 'text': 'Hello everyone, today we will take a walk in the park.'}, 'en')
    assert short.passed  # A valid short source is not forced to 240 characters.
    assert validate_translation(SOURCE, 'vi', {'title': 'Công viên', 'text': SOURCE}, 'vi', task='narration').passed
    uncertain = validate_translation('Công viên', 'vi', {'title': 'Park', 'text': 'Park'}, 'en')
    assert uncertain.status == 'uncertain' and 'language_uncertain' in uncertain.issues
    mixed = validate_translation(SOURCE, 'vi', {'title': 'Parc', 'text': french + '\n' + SOURCE[:180]}, 'fr')
    assert not mixed.passed and 'wrong_language' in mixed.issues
    one_arabic = validate_translation(SOURCE, 'vi', {'title': 'Park', 'text': SOURCE + ' ع'}, 'ar')
    assert 'wrong_script' in one_arabic.issues
    assert language_code('ms') != language_code('id')
    assert language_code('unknown') is None


@pytest.mark.parametrize('output,complete,issue', [
    ({'title': 'Title', 'text': ''}, True, 'empty_output'),
    ({'title': 'Title'}, True, 'empty_output'),
    ({'title': 'Title', 'text': 12}, True, 'invalid_output'),
    ({'title': 'Title', 'text': 'This is a complete sentence with damaged characters. \ufffd'}, True, 'damaged_unicode'),
    ({'title': 'Title', 'text': CORPUS['language_samples']['en']}, False, 'incomplete_generation'),
    ({'title': 'Title', 'text': 'Visitors can walk beside the river and watch the trees. ' * 5}, True, 'repetitive_output'),
])
def test_structure_is_checked(output, complete, issue):
    result = validate_translation(SOURCE, 'vi', output, 'en', generation_complete=complete)
    assert not result.passed and issue in result.issues


def test_wikipedia_summary_is_not_forced_to_match_full_article_length():
    article = {'source_locale': 'vi', 'text': SOURCE * 8}
    valid = validate_draft_translations(article, {
        'en': {'title': 'Park', 'text': CORPUS['language_samples']['en']}})
    assert valid['en'].passed
    copied = validate_draft_translations(article, {'en': {'title': 'Park', 'text': article['text']}})
    assert not copied['en'].passed and 'source_copy' in copied['en'].issues
