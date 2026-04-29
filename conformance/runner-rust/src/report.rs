//! JUnit XML report and summary tracking.

use std::collections::BTreeMap;

use crate::types::VectorResult;

#[derive(Debug, Default)]
pub struct Summary {
    pub total_pass: usize,
    pub total_fail: usize,
    pub per_category: BTreeMap<String, (usize, usize)>,
}

impl Summary {
    pub fn record_pass(&mut self, category: &str) {
        self.total_pass += 1;
        self.per_category
            .entry(category.to_string())
            .or_insert((0, 0))
            .0 += 1;
    }

    pub fn record_fail(&mut self, category: &str) {
        self.total_fail += 1;
        self.per_category
            .entry(category.to_string())
            .or_insert((0, 0))
            .1 += 1;
    }
}

pub struct JunitReport<'a> {
    suite_name: &'a str,
    results: &'a [VectorResult],
}

impl<'a> JunitReport<'a> {
    pub fn from_results(suite_name: &'a str, results: &'a [VectorResult]) -> Self {
        Self {
            suite_name,
            results,
        }
    }

    pub fn render(&self) -> String {
        let total = self.results.len();
        let failures = self.results.iter().filter(|r| r.outcome.is_err()).count();
        let total_time_ms: u64 = self.results.iter().map(|r| r.duration_ms).sum();

        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.push_str(&format!(
            "<testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" errors=\"0\" time=\"{:.3}\">\n",
            xml_escape(self.suite_name),
            total,
            failures,
            total_time_ms as f64 / 1000.0,
        ));
        for r in self.results {
            let classname = format!("{}.{}", r.category, r.file_name);
            xml.push_str(&format!(
                "  <testcase classname=\"{}\" name=\"{}\" time=\"{:.3}\"",
                xml_escape(&classname),
                xml_escape(&r.vector_name),
                r.duration_ms as f64 / 1000.0,
            ));
            match &r.outcome {
                Ok(_) => xml.push_str("/>\n"),
                Err(msg) => {
                    xml.push_str(">\n");
                    xml.push_str(&format!(
                        "    <failure message=\"{}\"></failure>\n",
                        xml_escape(msg)
                    ));
                    xml.push_str("  </testcase>\n");
                }
            }
        }
        xml.push_str("</testsuite>\n");
        xml
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
