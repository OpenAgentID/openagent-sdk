//! OpenAgent SDK conformance runner (Rust).
//!
//! Loads JSON test vectors from `conformance/vectors/**/*.json`, runs each vector
//! through the reference Rust implementation, compares the observed output to the
//! expected output, and emits a JUnit XML report plus a text summary.
//!
//! Usage:
//!     conformance-runner <vectors-dir> [--junit out.xml] [--filter category:name]
//!
//! Exit code: 0 if all vectors pass, 1 if any fail, 2 on IO/parse error.

mod handlers;
mod report;
mod types;

use std::path::PathBuf;
use std::process::ExitCode;

use crate::report::{JunitReport, Summary};
use crate::types::{VectorFile, VectorResult};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "usage: {} <vectors-dir> [--junit <path>] [--filter <category[:name]>]",
            args.first()
                .map(String::as_str)
                .unwrap_or("conformance-runner")
        );
        return ExitCode::from(2);
    }

    let vectors_dir = PathBuf::from(&args[1]);
    let mut junit_path: Option<PathBuf> = None;
    let mut filter: Option<String> = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--junit" => {
                if i + 1 >= args.len() {
                    eprintln!("--junit requires a path");
                    return ExitCode::from(2);
                }
                junit_path = Some(PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--filter" => {
                if i + 1 >= args.len() {
                    eprintln!("--filter requires a value");
                    return ExitCode::from(2);
                }
                filter = Some(args[i + 1].clone());
                i += 2;
            }
            other => {
                eprintln!("unknown argument: {other}");
                return ExitCode::from(2);
            }
        }
    }

    let files = match load_vector_files(&vectors_dir, filter.as_deref()) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("failed to load vectors from {}: {e}", vectors_dir.display());
            return ExitCode::from(2);
        }
    };

    let mut all_results: Vec<VectorResult> = Vec::new();
    let mut summary = Summary::default();

    for file in &files {
        println!(
            "\n[{}] {} ({} vectors)",
            file.category,
            file.name,
            file.vectors.len()
        );
        for vector in &file.vectors {
            let result = handlers::run_vector(&file.category, vector);
            match &result.outcome {
                Ok(_) => {
                    println!("  PASS  {}", vector.name);
                    summary.record_pass(&file.category);
                }
                Err(msg) => {
                    println!("  FAIL  {}: {}", vector.name, msg);
                    summary.record_fail(&file.category);
                }
            }
            all_results.push(result);
        }
    }

    println!("\n========= SUMMARY =========");
    for (cat, (pass, fail)) in &summary.per_category {
        println!(
            "  {cat:<12} {pass}/{total} passed",
            pass = pass,
            total = pass + fail
        );
    }
    println!(
        "  TOTAL        {passed}/{total} passed",
        passed = summary.total_pass,
        total = summary.total_pass + summary.total_fail
    );

    if let Some(path) = junit_path {
        let report = JunitReport::from_results("conformance-rust", &all_results);
        if let Err(e) = std::fs::write(&path, report.render()) {
            eprintln!("failed to write junit report to {}: {e}", path.display());
            return ExitCode::from(2);
        }
        println!("  junit report: {}", path.display());
    }

    if summary.total_fail == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn load_vector_files(
    root: &std::path::Path,
    filter: Option<&str>,
) -> Result<Vec<VectorFile>, Box<dyn std::error::Error>> {
    let mut files = Vec::new();
    // Categories are subdirectories of the vectors root.
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let category = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if let Some(f) = filter {
            let cat_filter = f.split(':').next().unwrap_or("");
            if !cat_filter.is_empty() && cat_filter != category {
                continue;
            }
        }
        for file_entry in std::fs::read_dir(&path)? {
            let file_entry = file_entry?;
            let file_path = file_entry.path();
            if file_path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let text = std::fs::read_to_string(&file_path)?;
            let raw: serde_json::Value = serde_json::from_str(&text)
                .map_err(|e| format!("parse {}: {e}", file_path.display()))?;
            let name = raw
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| {
                    file_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown")
                })
                .to_string();
            let vectors_arr = raw
                .get("vectors")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let vectors: Vec<types::Vector> = vectors_arr
                .into_iter()
                .map(|v| serde_json::from_value::<types::Vector>(v).unwrap())
                .collect();

            // Apply name filter if present
            let filtered_vectors = if let Some(f) = filter {
                let parts: Vec<&str> = f.splitn(2, ':').collect();
                if parts.len() == 2 && !parts[1].is_empty() {
                    vectors
                        .into_iter()
                        .filter(|v| v.name.contains(parts[1]))
                        .collect()
                } else {
                    vectors
                }
            } else {
                vectors
            };

            if filtered_vectors.is_empty() {
                continue;
            }

            files.push(VectorFile {
                category: category.clone(),
                name,
                vectors: filtered_vectors,
                source: file_path,
            });
        }
    }
    files.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(files)
}
