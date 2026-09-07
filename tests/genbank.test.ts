import assert from "node:assert/strict";
import test from "node:test";
import { genbankToJson } from "genbank-parser";
import { buildGenBank, mapExonsToCdna, translateDna, type GenBankRecord } from "../app/genbank.ts";

const TRANSCRIPT = "C29A12.4k.1";
const API = `https://rest.wormbase.org/rest/widget/transcript/${TRANSCRIPT}`;

async function widget(name: string) {
  const response = await fetch(`${API}/${name}`);
  assert.equal(response.status, 200, `${name} widget should respond`);
  return response.json() as Promise<any>;
}

function clean(value: string) {
  return value.replace(/[^A-Za-z*]/g, "").toUpperCase();
}

function deriveCds(cdna: string, protein: string) {
  const signature = protein.slice(0, 18);
  for (let start = 0; start < cdna.length - signature.length * 3; start++) {
    if (cdna.slice(start, start + 3) !== "ATG") continue;
    if (translateDna(cdna.slice(start, start + signature.length * 3)) !== signature) continue;
    const end = start + protein.length * 3;
    const stop = cdna.slice(end, end + 3);
    return cdna.slice(start, end + (["TAA", "TAG", "TGA"].includes(stop) ? 3 : 0));
  }
  throw new Error("CDS not found");
}

function parseGenBank(text: string) {
  const originText = text.split("\nORIGIN\n")[1]?.split("\n//")[0] ?? "";
  const sequence = originText.replace(/[^A-Za-z]/g, "").toUpperCase();
  const featureText = text.split("FEATURES             Location/Qualifiers\n")[1]?.split("\nORIGIN")[0] ?? "";
  const features = [...featureText.matchAll(/^ {5}(\S+)\s+(\d+)\.\.(\d+)$/gm)].map((match) => ({
    type: match[1], start: Number(match[2]), end: Number(match[3]),
  }));
  return { sequence, features };
}

test("C29A12.4k.1 annotated cDNA GenBank round-trips and has valid features", async () => {
  const [sequences, overview, location] = await Promise.all([widget("sequences"), widget("overview"), widget("location")]);
  const strand = sequences.fields.strand.data === "-" ? -1 : 1;
  const orientation = strand === -1 ? "negative_strand" : "positive_strand";
  const cdna = clean(sequences.fields.spliced_sequence_context.data[orientation].sequence);
  const protein = clean(sequences.fields.protein_sequence.data.sequence).replace(/\*$/, "");
  const cds = deriveCds(cdna, protein);
  const genomic = location.fields.genomic_position.data[0];
  const record: GenBankRecord = {
    geneName: overview.fields.corresponding_all.data[0].gene.label,
    transcriptId: TRANSCRIPT,
    cdna,
    cds,
    protein,
    exons: sequences.fields.predicted_exon_structure.data.map((exon: any) => ({
      start: strand === 1 ? genomic.start + exon.start - 1 : genomic.stop - exon.end + 1,
      end: strand === 1 ? genomic.start + exon.end - 1 : genomic.stop - exon.start + 1,
      strand,
      seq_region_name: genomic.seqname,
    })),
  };

  const mapped = mapExonsToCdna(record.cdna, record.exons);
  assert.equal(mapped.map((exon) => exon.sequence).join(""), cdna, "concatenated exon sequences must equal cDNA");
  for (let index = 0; index < mapped.length; index++) {
    assert.equal(mapped[index].cdnaStart, index === 0 ? 1 : mapped[index - 1].cdnaEnd + 1, "exons must be ordered and non-overlapping");
  }
  const translated = translateDna(cds);
  assert.equal(translated.slice(0, protein.length), protein, "CDS translation must match WormBase protein");
  assert.equal(translated.slice(0, -1).includes("*"), false, "CDS must not contain an internal stop codon");

  const generated = buildGenBank(record, "cdna");
  const parsed = parseGenBank(generated);
  assert.equal(parsed.sequence, cdna, "GenBank ORIGIN sequence must round-trip exactly");
  const exonFeatures = parsed.features.filter((item) => item.type === "exon");
  assert.equal(exonFeatures.length, mapped.length);
  assert.deepEqual(exonFeatures.map(({ start, end }) => ({ start, end })), mapped.map(({ cdnaStart: start, cdnaEnd: end }) => ({ start, end })));
  assert.equal(parsed.features.filter((item) => item.type === "CDS").length, 1);
  const standardParsed = genbankToJson(generated)[0];
  assert.equal(standardParsed.sequence.toUpperCase(), cdna, "standard GenBank parser must recover the exact cDNA");
  const standardExons = standardParsed.features.filter((item: any) => item.type === "exon");
  assert.equal(standardExons.length, mapped.length, "standard parser must recover every exon feature");
  assert.equal(standardExons[0].notes.ApEinfo_fwdcolor[0], "#F6B26B");
  assert.equal(standardExons[0].notes.ApEinfo_revcolor[0], "#F6B26B");
  assert.equal(standardExons[1].notes.ApEinfo_fwdcolor[0], "#9FC5E8");
  assert.equal(standardExons[2].notes.ApEinfo_fwdcolor[0], "#F6B26B", "exon colors must alternate");
  const standardCds = standardParsed.features.find((item: any) => item.type === "CDS");
  assert.equal(standardCds.notes.ApEinfo_fwdcolor[0], "#93C47D");
});

test("reverse-strand metadata does not reverse mature cDNA or exon order", () => {
  const record: GenBankRecord = {
    geneName: "reverse-test", transcriptId: "REV.1", cdna: "ATGAAATAA", cds: "ATGAAATAA", protein: "MK",
    exons: [
      { start: 200, end: 205, strand: -1, seq_region_name: "V" },
      { start: 100, end: 102, strand: -1, seq_region_name: "V" },
    ],
  };
  const parsed = parseGenBank(buildGenBank(record));
  assert.equal(parsed.sequence, record.cdna);
  assert.deepEqual(parsed.features.filter((item) => item.type === "exon").map(({ start, end }) => [start, end]), [[1, 6], [7, 9]]);
  assert.match(buildGenBank(record), /genomic strand: -/);
});

test("UTR features use colors distinct from exons and CDS", () => {
  const record: GenBankRecord = {
    geneName: "utr-test", transcriptId: "UTR.1", cdna: "CCCATGAAATAAGGG", cds: "ATGAAATAA", protein: "MK",
    exons: [
      { start: 1, end: 6, strand: 1, seq_region_name: "I" },
      { start: 20, end: 28, strand: 1, seq_region_name: "I" },
    ],
  };
  const parsed = genbankToJson(buildGenBank(record))[0];
  const utr5 = parsed.features.find((item: any) => item.type === "5'UTR");
  const utr3 = parsed.features.find((item: any) => item.type === "3'UTR");
  assert.equal(utr5.notes.ApEinfo_fwdcolor[0], "#FFD966");
  assert.equal(utr5.notes.ApEinfo_revcolor[0], "#FFD966");
  assert.equal(utr3.notes.ApEinfo_fwdcolor[0], "#B4A7D6");
  assert.equal(utr3.notes.ApEinfo_revcolor[0], "#B4A7D6");
});
