use std::{
    env,
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

use minisign_verify::{PublicKey, Signature};

const ARCHIVE_ENV: &str = "CTFBOX_UPDATER_ARCHIVE";
const SIGNATURE_ENV: &str = "CTFBOX_UPDATER_SIGNATURE";
const PUBLIC_KEY_ENV: &str = "CTFBOX_UPDATER_PUBLIC_KEY";

fn required_path(name: &str) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing required environment variable: {name}"))
}

fn archive_signature_is_valid(
    public_key: &PublicKey,
    signature: &Signature,
    archive_path: &Path,
    tamper_first_byte: bool,
) -> bool {
    let archive = File::open(archive_path)
        .unwrap_or_else(|error| panic!("failed to open updater archive: {error}"));
    let mut archive = BufReader::new(archive);
    let mut verifier = public_key
        .verify_stream(signature)
        .unwrap_or_else(|error| panic!("signature cannot be verified as a stream: {error}"));
    let mut buffer = [0_u8; 64 * 1024];
    let mut tampered = false;

    loop {
        let bytes_read = archive
            .read(&mut buffer)
            .unwrap_or_else(|error| panic!("failed to read updater archive: {error}"));
        if bytes_read == 0 {
            break;
        }
        if tamper_first_byte && !tampered {
            buffer[0] ^= 1;
            tampered = true;
        }
        verifier.update(&buffer[..bytes_read]);
    }

    assert!(
        !tamper_first_byte || tampered,
        "updater archive must not be empty"
    );
    verifier.finalize().is_ok()
}

#[test]
#[ignore = "requires a signed updater archive produced by the release build"]
fn signed_updater_archive_matches_embedded_public_key() {
    let archive_path = required_path(ARCHIVE_ENV);
    let signature_path = required_path(SIGNATURE_ENV);
    let public_key_path = required_path(PUBLIC_KEY_ENV);

    let public_key = PublicKey::from_file(&public_key_path)
        .unwrap_or_else(|error| panic!("invalid updater public key file: {error}"));
    let signature = Signature::from_file(&signature_path)
        .unwrap_or_else(|error| panic!("invalid updater signature file: {error}"));
    assert!(
        !signature.trusted_comment().is_empty(),
        "updater signature must include a trusted comment"
    );

    assert!(
        archive_signature_is_valid(&public_key, &signature, &archive_path, false),
        "updater signature verification failed"
    );
    assert!(
        !archive_signature_is_valid(&public_key, &signature, &archive_path, true),
        "tampered updater archive unexpectedly passed signature verification"
    );
}
