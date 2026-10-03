use serde::Serialize;

pub const LAUNCHER_SIZE: f64 = 580.0;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub size: u32,
    pub dpi_scale: f64,
}

pub fn centered(work: Rect, dpi_scale: f64, launcher_scale: f64) -> Placement {
    let dpi_scale = if dpi_scale.is_finite() && dpi_scale > 0.0 {
        dpi_scale
    } else {
        1.0
    };
    let desired = (LAUNCHER_SIZE * dpi_scale * launcher_scale)
        .round()
        .max(1.0) as u32;
    let size = desired.min(work.width).min(work.height).max(1);
    Placement {
        x: work.x + (work.width as i32 - size as i32) / 2,
        y: work.y + (work.height as i32 - size as i32) / 2,
        size,
        dpi_scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dpi_and_negative_monitor_coordinates() {
        let work = Rect {
            x: -2560,
            y: -320,
            width: 2560,
            height: 1400,
        };
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            let p = centered(work, dpi, 1.0);
            assert_eq!(p.size, (580.0 * dpi) as u32);
            assert!((p.x + p.size as i32 / 2 - (work.x + 1280)).abs() <= 1);
            assert!((p.y + p.size as i32 / 2 - (work.y + 700)).abs() <= 1);
        }
    }
    #[test]
    fn small_monitor_fits_and_invalid_dpi_falls_back() {
        let work = Rect {
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        };
        assert_eq!(centered(work, 2.0, 1.6).size, 600);
        assert_eq!(centered(work, f64::NAN, 1.0).size, 580);
    }
}
