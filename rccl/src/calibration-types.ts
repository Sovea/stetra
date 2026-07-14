export interface IndexedFile {
  path: string;
  language: string;
  lines: number;
  is_test: boolean;
  is_generated: boolean;
  package_root: string;
  imports_count: number;
  exports_count: number;
  symbol_density: number;
  role_hints: string[];
}

export interface RepoIndexReport {
  discovered_files: number;
  indexed_files: number;
  read_bytes: number;
  skipped_oversize: number;
  skipped_unsupported: number;
  truncated: Array<'file-count-limit' | 'total-read-limit'>;
}

export interface CalibrationWindow {
  file: string;
  start_line: number;
  end_line: number;
  purpose: 'header' | 'structure' | 'implementation';
  snippet: string;
}

export interface SamplingPolicy {
  max_slices: number;
  max_files_per_slice: number;
  max_windows_per_file: number;
  target_coverage: {
    roots: boolean;
    modules: boolean;
    boundaries: boolean;
    migrations: boolean;
    style_clusters: boolean;
  };
}
