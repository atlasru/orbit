use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat};
use orbit_core::{
    new_id,
    store::{atomic_write, read_limited},
    Action, Icon,
};
use std::{io::Cursor, path::Path};

pub fn normalize(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Icon exceeds 2 MiB".into());
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|e| format!("Invalid PNG, JPEG or ICO: {e}"))?;
    encode(&decoded.thumbnail(128, 128))
}

fn encode(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}

pub fn save(root: &Path, bytes: &[u8]) -> Result<String, String> {
    let bytes = normalize(bytes)?;
    let name = format!("{}.png", new_id());
    atomic_write(&root.join("icons").join(&name), &bytes)?;
    Ok(name)
}

pub fn resolve(root: &Path, icon: &Icon, action: &Action) -> Result<Option<String>, String> {
    let bytes = match icon {
        Icon::Custom { file } => {
            if !orbit_core::valid_icon_file(file) {
                return Err("Invalid icon path".into());
            }
            Some(read_limited(
                &root.join("icons").join(file),
                2 * 1024 * 1024,
            )?)
        }
        Icon::Auto => {
            let path = match action {
                Action::Application { executable, .. } | Action::Command { executable, .. } => {
                    Some(executable.as_str())
                }
                Action::File { path } | Action::Folder { path } => Some(path.as_str()),
                _ => None,
            };
            path.and_then(|p| native_icon(&crate::native::expand_environment(p)))
        }
        Icon::Builtin { .. } => None,
    };
    Ok(bytes.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes))))
}

#[cfg(not(windows))]
fn native_icon(_: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(windows)]
fn native_icon(path: &str) -> Option<Vec<u8>> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
            BI_RGB, DIB_RGB_COLORS,
        },
        UI::{
            Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_SMALLICON},
            WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL},
        },
    };
    unsafe {
        let path = crate::native::wide(path);
        let mut info: SHFILEINFOW = std::mem::zeroed();
        if SHGetFileInfoW(
            path.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_SMALLICON,
        ) == 0
            || info.hIcon.is_null()
        {
            return None;
        }
        let dc = CreateCompatibleDC(null_mut());
        if dc.is_null() {
            DestroyIcon(info.hIcon);
            return None;
        }
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of_val(&bmi.bmiHeader) as u32;
        bmi.bmiHeader.biWidth = 32;
        bmi.bmiHeader.biHeight = -32;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;
        let mut bits = null_mut();
        let bitmap = CreateDIBSection(dc, &bmi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        if bitmap.is_null() || bits.is_null() {
            DeleteDC(dc);
            DestroyIcon(info.hIcon);
            return None;
        }
        let old = SelectObject(dc, bitmap);
        std::ptr::write_bytes(bits, 0, 32 * 32 * 4);
        let drawn = DrawIconEx(dc, 0, 0, info.hIcon, 32, 32, 0, null_mut(), DI_NORMAL);
        let mut pixels = std::slice::from_raw_parts(bits as *const u8, 32 * 32 * 4).to_vec();
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
        if drawn == 0 {
            return None;
        }
        // DIB pixels are premultiplied BGRA. PNG expects straight RGBA.
        let has_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
        for p in pixels.chunks_exact_mut(4) {
            p.swap(0, 2);
            if !has_alpha {
                p[3] = if p[0] | p[1] | p[2] == 0 { 0 } else { 255 };
            }
            if p[3] > 0 && p[3] < 255 {
                for c in 0..3 {
                    p[c] = ((p[c] as u32 * 255) / p[3] as u32).min(255) as u8;
                }
            }
        }
        let image = image::RgbaImage::from_raw(32, 32, pixels)?;
        let _ = null::<u8>();
        encode(&DynamicImage::ImageRgba8(image)).ok()
    }
}
