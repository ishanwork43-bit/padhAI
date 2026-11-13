import pytest
from src.config import ConfigurationError, load_settings


def test_missing_and_blank_defaults(tmp_path):
    for env in [{}, {'OPENAI_API_KEY': ' ', 'OPENAI_MODEL': '', 'MAX_UPLOAD_MB': ''}]:
        settings = load_settings(env, tmp_path / '.env')
        assert not settings.ai_configured
        assert settings.max_upload_mb == 10
        assert settings.openai_model == 'gpt-4o-mini'


@pytest.mark.parametrize('value', ['1', '50', '001'])
def test_valid_limits(value, tmp_path):
    assert load_settings({'MAX_UPLOAD_MB': value}, tmp_path / '.env').max_upload_mb == int(value)


@pytest.mark.parametrize('value', ['0', '-1', '51', '1.5', 'abc', '+2', '١', '9'*5000])
def test_invalid_limits(value, tmp_path):
    with pytest.raises(ConfigurationError, match='MAX_UPLOAD_MB'):
        load_settings({'MAX_UPLOAD_MB': value}, tmp_path / '.env')


def test_precedence_and_literal_interpolation(tmp_path):
    path = tmp_path / '.env'
    path.write_text('OPENAI_API_KEY=file-secret\nMAX_UPLOAD_MB=20\nOPENAI_MODEL=${MODEL}\n')
    settings = load_settings({'OPENAI_API_KEY': '', 'MAX_UPLOAD_MB': '5'}, path)
    assert not settings.ai_configured
    assert settings.max_upload_mb == 5
    assert settings.openai_model == '${MODEL}'


def test_process_environment_and_secret_repr(tmp_path, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'secret-example')
    monkeypatch.setenv('MAX_UPLOAD_MB', '2')
    monkeypatch.setenv('OPENAI_MODEL', 'test-model')
    settings = load_settings(env_file=tmp_path / '.env')
    assert settings.ai_configured
    assert settings.max_upload_mb == 2
    assert 'secret-example' not in repr(settings)


@pytest.mark.parametrize('model', ['two words', 'x'*101, 'x\x00'])
def test_bad_model(model, tmp_path):
    with pytest.raises(ConfigurationError, match='OPENAI_MODEL'):
        load_settings({'OPENAI_MODEL': model}, tmp_path / '.env')


def test_bad_key_does_not_leak(tmp_path):
    secret = 'secret\nvalue'
    with pytest.raises(ConfigurationError) as caught:
        load_settings({'OPENAI_API_KEY': secret}, tmp_path / '.env')
    assert secret not in str(caught.value)


def test_invalid_utf8(tmp_path):
    path = tmp_path / '.env'
    path.write_bytes(b'\xff')
    with pytest.raises(ConfigurationError, match='UTF-8'):
        load_settings({}, path)


def test_read_failure(tmp_path, monkeypatch):
    path = tmp_path / '.env'
    path.touch()
    def denied(*args, **kwargs):
        raise PermissionError('private details')
    monkeypatch.setattr('src.config.dotenv_values', denied)
    with pytest.raises(ConfigurationError, match='Cannot read') as caught:
        load_settings({}, path)
    assert 'private details' not in str(caught.value)
