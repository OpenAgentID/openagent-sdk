//! Shared types used by the runner: the JSON vector shape and per-vector results.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Vector {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub input: serde_json::Value,
    pub expected_output: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct VectorFile {
    pub category: String,
    pub name: String,
    pub vectors: Vec<Vector>,
    pub source: PathBuf,
}

#[derive(Debug)]
pub struct VectorResult {
    pub category: String,
    pub file_name: String,
    pub vector_name: String,
    pub outcome: Result<(), String>,
    pub duration_ms: u64,
}
