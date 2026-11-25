#!/usr/bin/env bash
# Build the public CV for the homepage from the private resume source.
#
#   ./scripts/build_public_cv.sh [path/to/main.tex]     (default: ../resume/main.tex)
#
# The resume source is never modified. A copy is edited in a temp dir so that
#   1. phone numbers are removed, and
#   2. venues of papers under review are not named ("Submitted to X" -> "Under Review").
# The result is written to files/Yiyu_Li_CV.pdf, and the script fails if a phone
# number or a "Submitted to" line survives in the PDF.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$repo/../resume/main.tex}"
out="$repo/files/Yiyu_Li_CV.pdf"

[ -f "$src" ] || { echo "resume source not found: $src" >&2; exit 1; }
command -v latexmk >/dev/null || { echo "latexmk not found (install TeX Live / MacTeX)" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$src" "$tmp/cv.tex"

# -0777 slurps the whole file so the phone line can be removed together with its separator.
perl -0777 -i -pe '
  s/\\newcommand\{\\phone\}\{[^}]*\}/\\newcommand{\\phone}{}/;
  s/\n[ \t]*\\phone[ \t]*\n[ \t]*\\hspace\{[^}]*\}\\textcolor\{accent\}\{\\textperiodcentered\}\\hspace\{[^}]*\}//;
  s/\{Submitted to [^}]*\}/{Under Review}/g;
  s/ and submitted the paper to [A-Za-z ]+\d{4}\./ (paper under review)./g;
' "$tmp/cv.tex"

(cd "$tmp" && latexmk -pdf -interaction=nonstopmode -halt-on-error cv.tex >build.log 2>&1) \
  || { tail -30 "$tmp/build.log" >&2; echo "LaTeX build failed" >&2; exit 1; }

if command -v pdftotext >/dev/null; then
  text="$(pdftotext "$tmp/cv.pdf" -)"
  if grep -Eq '\+[0-9]{2,3}[- ]?[0-9]{6,}|[Ss]ubmitted to' <<<"$text"; then
    echo "refusing to publish: phone number or submission venue still present in the PDF" >&2
    exit 1
  fi
else
  echo "warning: pdftotext not found, skipping the leak check" >&2
fi

mkdir -p "$(dirname "$out")"
cp "$tmp/cv.pdf" "$out"
echo "wrote $out"
