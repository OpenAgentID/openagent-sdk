//! Parser for `SKILLS.md` files.
//!
//! A `SKILLS.md` file is a simple Markdown document where each `##`-level
//! heading names a skill and the paragraphs underneath describe it. This
//! matches the convention used by Claude Code's `Skill` tool discovery.
//!
//! Example:
//!
//! ```markdown
//! # Skills
//!
//! ## frontend-design
//!
//! Generate production-grade React components.
//!
//! ## deploy-production
//!
//! Deploy the current build to the production cluster.
//! ```
//!
//! We intentionally avoid pulling in a full Markdown AST crate: the grammar
//! we care about is trivial and a line-based scanner is both faster and
//! easier to audit.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{Result, SkillsPolicyError};

/// A single skill entry discovered in a `SKILLS.md` file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillEntry {
    /// Canonical skill name (the text of the `##` heading, trimmed).
    pub name: String,
    /// Human-readable description — all paragraphs beneath the heading,
    /// joined with blank lines.
    pub description: String,
}

/// A parsed `SKILLS.md` file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillsManifest {
    /// All skills discovered, in document order.
    pub skills: Vec<SkillEntry>,
}

impl SkillsManifest {
    /// Parse a `SKILLS.md` document from an in-memory string.
    ///
    /// # Errors
    /// Returns [`SkillsPolicyError::InvalidSkillsMarkdown`] if the document
    /// contains zero `##` skill headings or if a heading line is malformed.
    pub fn from_markdown(input: &str) -> Result<Self> {
        let mut skills: Vec<SkillEntry> = Vec::new();
        let mut current_name: Option<String> = None;
        let mut current_desc: Vec<String> = Vec::new();

        for raw_line in input.lines() {
            let line = raw_line.trim_end();

            if let Some(name) = parse_skill_heading(line) {
                // Flush previous skill if any.
                if let Some(prev_name) = current_name.take() {
                    skills.push(SkillEntry {
                        name: prev_name,
                        description: join_description(&current_desc),
                    });
                }
                current_desc.clear();
                current_name = Some(name);
                continue;
            }

            // Skip the top-level `# Skills` heading and any other H1s.
            if line.starts_with("# ") {
                continue;
            }

            if current_name.is_some() {
                current_desc.push(line.to_string());
            }
        }

        // Flush trailing skill.
        if let Some(name) = current_name.take() {
            skills.push(SkillEntry {
                name,
                description: join_description(&current_desc),
            });
        }

        if skills.is_empty() {
            return Err(SkillsPolicyError::InvalidSkillsMarkdown(
                "no `## <skill>` headings found".to_string(),
            ));
        }

        // Reject duplicate skill names — they're an authoring bug and would
        // silently cause policy mismatches.
        for i in 0..skills.len() {
            for j in (i + 1)..skills.len() {
                if skills[i].name == skills[j].name {
                    return Err(SkillsPolicyError::InvalidSkillsMarkdown(format!(
                        "duplicate skill `{}`",
                        skills[i].name
                    )));
                }
            }
        }

        Ok(Self { skills })
    }

    /// Load and parse a `SKILLS.md` file from disk.
    ///
    /// # Errors
    /// Returns [`SkillsPolicyError::Io`] on read failure or
    /// [`SkillsPolicyError::InvalidSkillsMarkdown`] on parse failure.
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path).map_err(|source| SkillsPolicyError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_markdown(&content)
    }

    /// Number of skills discovered.
    #[must_use]
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// Whether the manifest contains zero skills.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// Return the skill entry with the given name, if any.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&SkillEntry> {
        self.skills.iter().find(|s| s.name == name)
    }

    /// Iterate all skill names.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.skills.iter().map(|s| s.name.as_str())
    }
}

/// Parse a line as a `## skill-name` heading, returning the trimmed name.
///
/// Returns `None` if the line is not a level-2 heading.
fn parse_skill_heading(line: &str) -> Option<String> {
    // `##` followed by whitespace followed by a name.
    let rest = line.strip_prefix("##")?;
    // Reject `###` (level 3 and deeper).
    if rest.starts_with('#') {
        return None;
    }
    let name = rest.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

/// Collapse a description's raw lines into a single string, stripping leading
/// and trailing blank lines and joining with newlines.
fn join_description(lines: &[String]) -> String {
    // Find first and last non-empty line.
    let first = lines.iter().position(|l| !l.trim().is_empty());
    let last = lines.iter().rposition(|l| !l.trim().is_empty());
    match (first, last) {
        (Some(f), Some(l)) => lines[f..=l].join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_skills() {
        let input = "# Skills\n\n## foo\n\nDoes foo things.\n\n## bar\n\nDoes bar things.\n";
        let manifest = SkillsManifest::from_markdown(input).expect("parses");
        assert_eq!(manifest.len(), 2);
        assert_eq!(manifest.skills[0].name, "foo");
        assert_eq!(manifest.skills[0].description, "Does foo things.");
        assert_eq!(manifest.skills[1].name, "bar");
    }

    #[test]
    fn rejects_empty_manifest() {
        let err = SkillsManifest::from_markdown("# Skills\n\nNo skills here.\n").unwrap_err();
        assert!(matches!(err, SkillsPolicyError::InvalidSkillsMarkdown(_)));
    }

    #[test]
    fn rejects_duplicate_skills() {
        let input = "## foo\n\nFirst.\n\n## foo\n\nSecond.\n";
        let err = SkillsManifest::from_markdown(input).unwrap_err();
        assert!(matches!(err, SkillsPolicyError::InvalidSkillsMarkdown(_)));
    }

    #[test]
    fn collects_multiline_descriptions() {
        let input = "## deploy\n\nLine one.\n\nLine two.\n\n## read\n\nRead stuff.\n";
        let manifest = SkillsManifest::from_markdown(input).expect("parses");
        assert_eq!(manifest.skills[0].name, "deploy");
        assert!(manifest.skills[0].description.contains("Line one."));
        assert!(manifest.skills[0].description.contains("Line two."));
    }

    #[test]
    fn ignores_h3_and_deeper() {
        let input = "## foo\n\n### not-a-skill\n\nNested heading.\n";
        let manifest = SkillsManifest::from_markdown(input).expect("parses");
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest.skills[0].name, "foo");
    }

    #[test]
    fn heading_parser_accepts_and_rejects() {
        assert_eq!(parse_skill_heading("## hello"), Some("hello".to_string()));
        assert_eq!(
            parse_skill_heading("##   spaced  "),
            Some("spaced".to_string())
        );
        assert_eq!(parse_skill_heading("### nope"), None);
        assert_eq!(parse_skill_heading("# h1"), None);
        assert_eq!(parse_skill_heading("regular text"), None);
        assert_eq!(parse_skill_heading("## "), None);
    }
}
