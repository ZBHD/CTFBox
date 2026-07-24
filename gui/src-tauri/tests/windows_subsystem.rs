#[cfg(all(windows, not(debug_assertions)))]
#[test]
fn release_binary_uses_windows_gui_subsystem() {
    let executable = env!("CARGO_BIN_EXE_ctfbox");
    let bytes = std::fs::read(executable).expect("failed to read ctfbox executable");
    let pe_offset = u32::from_le_bytes(bytes[0x3c..0x40].try_into().unwrap()) as usize;
    let optional_header = pe_offset + 24;
    let subsystem_offset = optional_header + 0x44;
    let subsystem = u16::from_le_bytes(
        bytes[subsystem_offset..subsystem_offset + 2]
            .try_into()
            .unwrap(),
    );

    assert_eq!(
        subsystem, 2,
        "release ctfbox.exe must use IMAGE_SUBSYSTEM_WINDOWS_GUI"
    );
}
