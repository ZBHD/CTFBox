use std::{
    env,
    fs::File,
    io::{BufReader, Read},
    path::PathBuf,
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

    let archive = File::open(&archive_path)
        .unwrap_or_else(|error| panic!("failed to open updater archive: {error}"));
    let mut archive = BufReader::new(archive);
    let mut verifier = public_key
        .verify_stream(&signature)
        .unwrap_or_else(|error| panic!("signature cannot be verified as a stream: {error}"));
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let bytes_read = archive
            .read(&mut buffer)
            .unwrap_or_else(|error| panic!("failed to read updater archive: {error}"));
        if bytes_read == 0 {
            break;
        }
        verifier.update(&buffer[..bytes_read]);
    }

    verifier
        .finalize()
        .unwrap_or_else(|error| panic!("updater signature verification failed: {error}"));
}
