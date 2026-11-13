"""Release archives must be reproducible and must not collect local private files."""
import hashlib
import os
from pathlib import Path
import stat
import zipfile

import pytest

from scripts.build_release import FIXED_TIMESTAMP, ReleaseError, build_release


@pytest.fixture
def source_tree(tmp_path):
    root = tmp_path / 'project'
    root.mkdir()
    (root / 'VERSION').write_text('0.1.0\n')
    (root / 'README.md').write_text('PadhAI study companion\n')
    (root / '.env.example').write_text('OPENAI_API_KEY=\n')
    manifest = root / 'release-files.txt'
    manifest.write_text('# Explicit release inputs\nVERSION\nrelease-files.txt\nREADME.md\n.env.example\n')
    return root


def add_to_manifest(root, name):
    path = root / 'release-files.txt'
    path.write_text(path.read_text() + name + '\n')


def test_archive_contains_only_manifest_files_and_valid_checksum(source_tree, tmp_path):
    (source_tree / '.env').write_text('PRIVATE-API-KEY')
    (source_tree / 'private-notes.txt').write_text('PRIVATE-NOTES')
    zip_path, checksum_path = build_release(source_tree, tmp_path / 'output')
    assert zip_path.name == 'padhai-0.1.0.zip'
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    assert checksum_path.read_text() == f'{digest}  padhai-0.1.0.zip\n'
    with zipfile.ZipFile(zip_path) as archive:
        assert archive.testzip() is None
        assert archive.namelist() == [
            'padhai-0.1.0/.env.example', 'padhai-0.1.0/README.md',
            'padhai-0.1.0/VERSION', 'padhai-0.1.0/release-files.txt',
        ]
        assert archive.read('padhai-0.1.0/README.md') == (source_tree / 'README.md').read_bytes()
        for entry in archive.infolist():
            assert entry.date_time == FIXED_TIMESTAMP
            assert stat.S_IMODE(entry.external_attr >> 16) == 0o644
            assert entry.create_system == 3


def test_reproducible_despite_source_timestamps_permissions_and_output_location(source_tree, tmp_path):
    first, _ = build_release(source_tree, tmp_path / 'first')
    before = first.read_bytes()
    os.utime(source_tree / 'README.md', (1_000_000_000, 1_000_000_000))
    (source_tree / 'README.md').chmod(0o600)
    second, _ = build_release(source_tree, tmp_path / 'second')
    assert second.read_bytes() == before


def test_unicode_paths_and_binary_contents_are_preserved(source_tree, tmp_path):
    name = 'sample_data/पढ़ाई.pdf'
    path = source_tree / name
    path.parent.mkdir()
    path.write_bytes(b'%PDF-1.7\n\x00\xff')
    add_to_manifest(source_tree, name)
    result, _ = build_release(source_tree, tmp_path / 'output')
    with zipfile.ZipFile(result) as archive:
        assert archive.read('padhai-0.1.0/' + name) == path.read_bytes()
        assert archive.getinfo('padhai-0.1.0/' + name).flag_bits & 0x800


@pytest.mark.parametrize('name', [
    '/etc/passwd', '../private.txt', 'folder/../README.md', './README.md',
    'folder//README.md', r'folder\README.md', 'C:secrets.txt', 'tab\tname.txt',
    'null\x00name.txt', 'hidden\u200b.txt',
])
def test_unsafe_manifest_paths_fail_before_output_creation(source_tree, tmp_path, name):
    add_to_manifest(source_tree, name)
    output = tmp_path / 'output'
    with pytest.raises(ReleaseError):
        build_release(source_tree, output)
    assert not output.exists()


@pytest.mark.parametrize('name', [
    '.env', '.env.production', '.ENV', 'config/.env.backup', 'config/.env/secret.txt',
    '.streamlit/secrets.toml', 'secrets.toml', '.git/config', '.git', '.venv/pyvenv.cfg',
    '__pycache__/cached.pyc', '.pytest_cache/README.md', '.cache/model.txt',
    'private.db', 'private.sqlite', 'private.sqlite3', 'private.sqlite-wal',
    'cert.pem', 'key.key', 'bundle.zip', 'bundle.zip.sha256', 'data/notes.txt',
])
def test_secret_database_and_generated_paths_are_rejected(source_tree, tmp_path, name):
    add_to_manifest(source_tree, name)
    with pytest.raises(ReleaseError, match='secret|database|archive|cache'):
        build_release(source_tree, tmp_path / 'output')


@pytest.mark.parametrize('version', ['../x', 'v0.1.0', '01.1.0', '1.2', '1.2.3-extra',
                                      '1.2.3\n4.5.6', ' 1.2.3', '١.2.3', '1.2.3\x00'])
def test_malformed_version_never_creates_artifacts(source_tree, tmp_path, version):
    (source_tree / 'VERSION').write_text(version)
    with pytest.raises(ReleaseError):
        build_release(source_tree, tmp_path / 'output')
    assert not (tmp_path / 'output').exists()


@pytest.mark.parametrize('name', ['README.md', 'readme.MD'])
def test_duplicate_or_portably_colliding_names_are_rejected(source_tree, tmp_path, name):
    add_to_manifest(source_tree, name)
    with pytest.raises(ReleaseError, match='duplicate'):
        build_release(source_tree, tmp_path / 'output')


@pytest.mark.parametrize('required', ['VERSION', 'release-files.txt'])
def test_required_metadata_must_be_listed(source_tree, tmp_path, required):
    manifest = source_tree / 'release-files.txt'
    manifest.write_text('\n'.join(line for line in manifest.read_text().splitlines() if line != required))
    with pytest.raises(ReleaseError, match='must include'):
        build_release(source_tree, tmp_path / 'output')


def test_missing_source_does_not_overwrite_existing_artifacts(source_tree, tmp_path):
    output = tmp_path / 'output'
    artifact, checksum = build_release(source_tree, output)
    previous = artifact.read_bytes(), checksum.read_bytes()
    add_to_manifest(source_tree, 'missing.py')
    with pytest.raises(ReleaseError, match='existing regular file'):
        build_release(source_tree, output)
    assert (artifact.read_bytes(), checksum.read_bytes()) == previous
    assert sorted(path.name for path in output.iterdir()) == [artifact.name, checksum.name]


def test_directory_entry_is_not_treated_as_recursive_input(source_tree, tmp_path):
    (source_tree / 'docs').mkdir()
    add_to_manifest(source_tree, 'docs')
    with pytest.raises(ReleaseError, match='regular file'):
        build_release(source_tree, tmp_path / 'output')


@pytest.mark.parametrize('kind', ['file', 'ancestor', 'root', 'output', 'artifact'])
def test_symlinks_are_rejected_without_modifying_targets(source_tree, tmp_path, kind):
    outside = tmp_path / 'outside'
    outside.mkdir()
    private = outside / 'private.txt'
    private.write_text('PRIVATE')
    output = tmp_path / 'output'
    root = source_tree
    if kind == 'file':
        (root / 'linked.txt').symlink_to(private)
        add_to_manifest(root, 'linked.txt')
    elif kind == 'ancestor':
        (root / 'linked').symlink_to(outside, target_is_directory=True)
        add_to_manifest(root, 'linked/private.txt')
    elif kind == 'root':
        root = tmp_path / 'linked-project'
        root.symlink_to(source_tree, target_is_directory=True)
    elif kind == 'output':
        output.symlink_to(outside, target_is_directory=True)
    else:
        output.mkdir()
        (output / 'padhai-0.1.0.zip').symlink_to(private)
    with pytest.raises(ReleaseError, match='Symlinks'):
        build_release(root, output)
    assert private.read_text() == 'PRIVATE'


def test_comments_blank_lines_and_crlf_are_accepted(source_tree, tmp_path):
    manifest = source_tree / 'release-files.txt'
    manifest.write_bytes(b'# comment\r\n\r\nVERSION\r\nrelease-files.txt\r\nREADME.md\r\n')
    (source_tree / 'VERSION').write_bytes(b'0.1.0\r\n')
    artifact, _ = build_release(source_tree, tmp_path / 'output')
    assert artifact.exists()


def test_failed_zip_write_preserves_previous_artifacts_and_cleans_temporary_files(source_tree, tmp_path, monkeypatch):
    output = tmp_path / 'output'
    artifact, checksum = build_release(source_tree, output)
    previous = artifact.read_bytes(), checksum.read_bytes()
    def fail(*args, **kwargs):
        raise OSError('disk full')
    monkeypatch.setattr(zipfile.ZipFile, 'writestr', fail)
    with pytest.raises(ReleaseError, match='could not be written'):
        build_release(source_tree, output)
    assert (artifact.read_bytes(), checksum.read_bytes()) == previous
    assert len(list(output.iterdir())) == 2
