#![allow(dead_code)]

pub const PRELOADER_CACHE_SIZE: usize = 200;
pub const THUMBNAIL_CACHE_SIZE: usize = 1000;
pub const IMAGE_INFO_CACHE_SIZE: usize = 2000;
pub const IMAGE_SIZE_THUMBNAIL: u32 = 128;
pub const IMAGE_SIZE_PREVIEW: u32 = 512;
pub const IMAGE_SIZE_FULL: u32 = 2048;
pub const IMAGE_SIZE_DEFAULT: u32 = 512;
pub const PNG_MAX_SIZE: u32 = 8192;

pub const SEARCH_MAX_FILENAME_RESULTS: usize = 100;
pub const SEARCH_MAX_CONTENT_RESULTS: usize = 200;
pub const SEARCH_MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
pub const LOG_MAX_LINES: usize = 50;

pub const DEFAULT_CONCURRENT_DOWNLOADS: usize = 32;
pub const MAX_CONCURRENT_DOWNLOADS: usize = 256;

pub const CJK_UNIFIED_START: u32 = 0x4E00;
pub const CJK_UNIFIED_END: u32 = 0x9FFF;
pub const CJK_EXT_A_START: u32 = 0x3400;
pub const CJK_EXT_A_END: u32 = 0x4DBF;

pub fn is_cjk_char(c: char) -> bool {
    let code = c as u32;
    (code >= CJK_UNIFIED_START && code <= CJK_UNIFIED_END)
        || (code >= CJK_EXT_A_START && code <= CJK_EXT_A_END)
        || (code >= 0xF900 && code <= 0xFAFF)
        || (code >= 0x20000 && code <= 0x2A6DF)
}

pub const WEB_SERVER_TOKEN_LENGTH: usize = 32;

pub const FETCH_BLOCKED_HOSTS: &[&str] = &[
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "169.254.169.254",
    "metadata.google.internal",
    "100.100.100.200",
];

pub const FETCH_TRUSTED_DOMAINS: &[&str] = &[
    "mojang.com",
    "minecraft.net",
    "launchermeta.mojang.com",
    "piston-meta.mojang.com",
    "piston-data.mojang.com",
    "resources.download.minecraft.net",
    "gitee.com",
    "github.com",
    "raw.githubusercontent.com",
    "cdn.jsdelivr.net",
];

pub fn is_trusted_domain(host: &str) -> bool {
    FETCH_TRUSTED_DOMAINS.iter().any(|trusted| {
        host == *trusted || host.ends_with(&format!(".{}", trusted))
    })
}

pub fn is_blocked_host(host: &str) -> bool {
    if FETCH_BLOCKED_HOSTS.contains(&host) {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        let octets = ip.octets();
        return octets[0] == 10
            || (octets[0] == 172 && (16..=31).contains(&octets[1]))
            || (octets[0] == 192 && octets[1] == 168)
            || octets[0] == 127
            || (octets[0] == 169 && octets[1] == 254);
    }
    false
}
