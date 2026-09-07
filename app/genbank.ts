export type GenBankExon = {
  id?: string;
  start: number;
  end: number;
  strand: number;
  seq_region_name: string;
};

export type GenBankRecord = {
  geneName: string;
  geneId?: string;
  transcriptId: string;
  cdna: string;
  cds: string;
  protein: string;
  exons: GenBankExon[];
};

export type CdnaExon = GenBankExon & {
  number: number;
  cdnaStart: number;
  cdnaEnd: number;
  sequence: string;
};

const FEATURE_INDENT = "                     ";
const FEATURE_COLORS = {
  exonOdd: "#F6B26B",
  exonEven: "#9FC5E8",
  cds: "#93C47D",
  utr5: "#FFD966",
  utr3: "#B4A7D6",
} as const;

function apeColor(color: string): Array<[string, string]> {
  return [
    ["ApEinfo_fwdcolor", color],
    ["ApEinfo_revcolor", color],
  ];
}

function quote(value: string) {
  return `"${value.replaceAll('"', "'")}"`;
}

export function translateDna(dna: string) {
  const table: Record<string, string> = {
    TTT:"F",TTC:"F",TTA:"L",TTG:"L",TCT:"S",TCC:"S",TCA:"S",TCG:"S",TAT:"Y",TAC:"Y",TAA:"*",TAG:"*",TGT:"C",TGC:"C",TGA:"*",TGG:"W",
    CTT:"L",CTC:"L",CTA:"L",CTG:"L",CCT:"P",CCC:"P",CCA:"P",CCG:"P",CAT:"H",CAC:"H",CAA:"Q",CAG:"Q",CGT:"R",CGC:"R",CGA:"R",CGG:"R",
    ATT:"I",ATC:"I",ATA:"I",ATG:"M",ACT:"T",ACC:"T",ACA:"T",ACG:"T",AAT:"N",AAC:"N",AAA:"K",AAG:"K",AGT:"S",AGC:"S",AGA:"R",AGG:"R",
    GTT:"V",GTC:"V",GTA:"V",GTG:"V",GCT:"A",GCC:"A",GCA:"A",GCG:"A",GAT:"D",GAC:"D",GAA:"E",GAG:"E",GGT:"G",GGC:"G",GGA:"G",GGG:"G",
  };
  let protein = "";
  for (let i = 0; i + 2 < dna.length; i += 3) protein += table[dna.slice(i, i + 3).toUpperCase()] || "X";
  return protein;
}

function feature(type: string, location: string, qualifiers: Array<[string, string]>) {
  const lines = [`     ${type.padEnd(16)}${location}`];
  for (const [key, value] of qualifiers) {
    const prefix = `${FEATURE_INDENT}/${key}=`;
    const rendered = quote(value);
    const width = 79 - prefix.length;
    if (rendered.length <= width) {
      lines.push(prefix + rendered);
      continue;
    }
    let remaining = rendered;
    lines.push(prefix + remaining.slice(0, width));
    remaining = remaining.slice(width);
    while (remaining) {
      lines.push(FEATURE_INDENT + remaining.slice(0, 58));
      remaining = remaining.slice(58);
    }
  }
  return lines.join("\n");
}

function origin(sequence: string) {
  const lower = sequence.toLowerCase();
  const lines: string[] = [];
  for (let offset = 0; offset < lower.length; offset += 60) {
    const groups = lower.slice(offset, offset + 60).match(/.{1,10}/g)?.join(" ") ?? "";
    lines.push(`${String(offset + 1).padStart(9)} ${groups}`);
  }
  return lines.join("\n");
}

export function mapExonsToCdna(cdna: string, exons: GenBankExon[]): CdnaExon[] {
  let offset = 0;
  const mapped = exons.map((exon, index) => {
    const length = Math.abs(exon.end - exon.start) + 1;
    const cdnaStart = offset + 1;
    const cdnaEnd = offset + length;
    const mappedExon = {
      ...exon,
      number: index + 1,
      cdnaStart,
      cdnaEnd,
      sequence: cdna.slice(offset, cdnaEnd),
    };
    offset = cdnaEnd;
    return mappedExon;
  });
  if (offset !== cdna.length) throw new Error(`Exon lengths (${offset}) do not equal cDNA length (${cdna.length}).`);
  return mapped;
}

export function buildGenBank(record: GenBankRecord, mode: "cdna" | "cds" = "cdna") {
  const cdsOffset = record.cdna.indexOf(record.cds);
  if (cdsOffset < 0) throw new Error("CDS is not contained in the cDNA sequence.");
  const cdsStart = cdsOffset + 1;
  const cdsEnd = cdsOffset + record.cds.length;
  const sequence = mode === "cdna" ? record.cdna : record.cds;
  const mappedExons = mapExonsToCdna(record.cdna, record.exons);
  const locus = `${record.transcriptId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 16)}`;
  const features: string[] = [feature("source", `1..${sequence.length}`, [
    ["organism", "Caenorhabditis elegans"],
    ["mol_type", mode === "cdna" ? "mRNA" : "other DNA"],
  ])];

  if (mode === "cdna") {
    features.push(feature("mRNA", `1..${sequence.length}`, [
      ["gene", record.geneName],
      ["transcript_id", record.transcriptId],
    ]));
    if (cdsStart > 1) features.push(feature("5'UTR", `1..${cdsStart - 1}`, [
      ["gene", record.geneName],
      ...apeColor(FEATURE_COLORS.utr5),
    ]));
  }

  for (const exon of mappedExons) {
    const start = mode === "cdna" ? exon.cdnaStart : Math.max(exon.cdnaStart, cdsStart) - cdsStart + 1;
    const end = mode === "cdna" ? exon.cdnaEnd : Math.min(exon.cdnaEnd, cdsEnd) - cdsStart + 1;
    if (start > end || end < 1 || start > sequence.length) continue;
    features.push(feature("exon", `${Math.max(1, start)}..${Math.min(sequence.length, end)}`, [
      ["label", `Exon ${exon.number}`],
      ...apeColor(exon.number % 2 === 1 ? FEATURE_COLORS.exonOdd : FEATURE_COLORS.exonEven),
      ["gene", record.geneName],
      ["transcript_id", record.transcriptId],
      ["note", `Genomic coordinates: ${exon.seq_region_name}:${Math.min(exon.start, exon.end)}-${Math.max(exon.start, exon.end)}; genomic strand: ${exon.strand === -1 ? "-" : "+"}`],
    ]));
  }

  features.push(feature("CDS", mode === "cdna" ? `${cdsStart}..${cdsEnd}` : `1..${sequence.length}`, [
    ["gene", record.geneName],
    ["transcript_id", record.transcriptId],
    ["codon_start", "1"],
    ["translation", record.protein.replace(/\*$/, "")],
    ...apeColor(FEATURE_COLORS.cds),
  ]));
  if (mode === "cdna" && cdsEnd < record.cdna.length) {
    features.push(feature("3'UTR", `${cdsEnd + 1}..${record.cdna.length}`, [
      ["gene", record.geneName],
      ...apeColor(FEATURE_COLORS.utr3),
    ]));
  }

  return [
    `LOCUS       ${locus.padEnd(16)} ${String(sequence.length).padStart(7)} bp    DNA     linear   INV 01-JAN-2000`,
    `DEFINITION  Spliced ${mode === "cdna" ? "cDNA" : "CDS"} of ${record.transcriptId} (${record.geneName}).`,
    `ACCESSION   ${record.transcriptId}`,
    `VERSION     ${record.transcriptId}`,
    "KEYWORDS    .",
    "SOURCE      Caenorhabditis elegans",
    "  ORGANISM  Caenorhabditis elegans",
    "            Eukaryota; Metazoa; Nematoda; Chromadorea; Rhabditida.",
    "FEATURES             Location/Qualifiers",
    ...features,
    "ORIGIN",
    origin(sequence),
    "//",
    "",
  ].join("\n");
}
