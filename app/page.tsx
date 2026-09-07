"use client";

import { FormEvent, useMemo, useState } from "react";
import { buildGenBank, mapExonsToCdna } from "./genbank";

const API = "https://rest.wormbase.org/rest/widget/transcript";

type Exon = {
  id: string;
  start: number;
  end: number;
  strand: number;
  seq_region_name: string;
  sequence?: string;
};

type Result = {
  geneName: string;
  geneId: string;
  transcriptId: string;
  cdna: string;
  cds: string;
  protein: string;
  proteinLength: number | null;
  exons: Exon[];
};

async function getWidget(transcriptId: string, widget: string) {
  const url = `${API}/${encodeURIComponent(transcriptId)}/${widget}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 404 ? "Transcript ID was not found." : `WormBase returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (!payload?.fields) throw new Error("WormBase returned an unexpected response.");
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function cleanSequence(payload: any) {
  const value = typeof payload === "string" ? payload : payload?.sequence;
  if (!value) throw new Error("The sequence was not returned by WormBase.");
  return value.replace(/^>.*$/gm, "").replace(/[^A-Za-z*]/g, "").toUpperCase();
}

const CODONS: Record<string, string> = {
  TTT:"F",TTC:"F",TTA:"L",TTG:"L",TCT:"S",TCC:"S",TCA:"S",TCG:"S",TAT:"Y",TAC:"Y",TAA:"*",TAG:"*",TGT:"C",TGC:"C",TGA:"*",TGG:"W",
  CTT:"L",CTC:"L",CTA:"L",CTG:"L",CCT:"P",CCC:"P",CCA:"P",CCG:"P",CAT:"H",CAC:"H",CAA:"Q",CAG:"Q",CGT:"R",CGC:"R",CGA:"R",CGG:"R",
  ATT:"I",ATC:"I",ATA:"I",ATG:"M",ACT:"T",ACC:"T",ACA:"T",ACG:"T",AAT:"N",AAC:"N",AAA:"K",AAG:"K",AGT:"S",AGC:"S",AGA:"R",AGG:"R",
  GTT:"V",GTC:"V",GTA:"V",GTG:"V",GCT:"A",GCC:"A",GCA:"A",GCG:"A",GAT:"D",GAC:"D",GAA:"E",GAG:"E",GGT:"G",GGC:"G",GGA:"G",GGG:"G",
};

function translate(dna: string) {
  let protein = "";
  for (let i = 0; i + 2 < dna.length; i += 3) protein += CODONS[dna.slice(i, i + 3)] || "X";
  return protein;
}

function deriveCds(cdna: string, protein: string) {
  const signature = protein.slice(0, Math.min(18, protein.length));
  for (let start = 0; start < cdna.length - signature.length * 3; start++) {
    if (cdna.slice(start, start + 3) === "ATG" && translate(cdna.slice(start, start + signature.length * 3)) === signature) {
      const codingEnd = start + protein.length * 3;
      const stop = cdna.slice(codingEnd, codingEnd + 3);
      return cdna.slice(start, codingEnd + (["TAA", "TAG", "TGA"].includes(stop) ? 3 : 0));
    }
  }
  throw new Error("CDS boundaries could not be matched to the protein sequence.");
}

function wrapSequence(sequence: string, width = 70) {
  return sequence.match(new RegExp(`.{1,${width}}`, "g"))?.join("\n") ?? "";
}

function saveFasta(result: Result) {
  const body = `>${result.transcriptId} cdna gene=${result.geneName}\n${wrapSequence(result.cdna)}\n>${result.transcriptId} cds gene=${result.geneName}\n${wrapSequence(result.cds)}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${result.transcriptId}.fasta`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveText(filename: string, body: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveGenBank(result: Result, mode: "cdna" | "cds") {
  const body = buildGenBank(result, mode);
  saveText(`${result.transcriptId}.annotated_${mode}.gb`, body, "chemical/x-genbank;charset=utf-8");
}

export default function Home() {
  const [id, setId] = useState("C29A12.4k.1");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const exonBlocks = useMemo(() => {
    if (!result) return [];
    return mapExonsToCdna(result.cdna, result.exons);
  }, [result]);

  async function fetchTranscript(event: FormEvent) {
    event.preventDefault();
    const transcriptId = id.trim();
    if (!transcriptId) return;
    setLoading(true);
    setError("");
    setResult(null);
    setCopied("");
    try {
      const [sequences, overview, location] = await Promise.all([
        getWidget(transcriptId, "sequences"),
        getWidget(transcriptId, "overview"),
        getWidget(transcriptId, "location"),
      ]);
      const strandText = sequences.fields.strand?.data || sequences.fields.spliced_sequence_context?.data?.strand || "+";
      const strand = strandText === "-" ? -1 : 1;
      const orientation = strand === -1 ? "negative_strand" : "positive_strand";
      const cdna = cleanSequence(sequences.fields.spliced_sequence_context?.data?.[orientation]);
      const protein = cleanSequence(sequences.fields.protein_sequence?.data).replace(/\*$/, "");
      const cds = deriveCds(cdna, protein);
      const correspondence = overview.fields.corresponding_all?.data?.[0];
      const genomic = location.fields.genomic_position?.data?.[0];
      const relativeExons = sequences.fields.predicted_exon_structure?.data || [];
      const exons: Exon[] = relativeExons.map((exon: any, index: number) => ({
        id: `${transcriptId}:exon${index + 1}`,
        start: strand === 1 ? genomic.start + exon.start - 1 : genomic.stop - exon.end + 1,
        end: strand === 1 ? genomic.start + exon.end - 1 : genomic.stop - exon.start + 1,
        strand,
        seq_region_name: genomic.seqname,
      }));
      setResult({
        geneName: correspondence?.gene?.label || "—",
        geneId: correspondence?.gene?.id || "",
        transcriptId: sequences.name || transcriptId,
        cdna,
        cds,
        protein,
        proteinLength: protein.length,
        exons,
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Unknown error";
      setError(`取得できませんでした。ID を確認して、しばらくしてから再試行してください。 (${detail})`);
    } finally {
      setLoading(false);
    }
  }

  async function copy(label: string, sequence: string) {
    await navigator.clipboard.writeText(sequence);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }

  return (
    <main>
      <header className="hero">
        <div className="eyebrow"><span className="dot" /> C. ELEGANS · TRANSCRIPT EXPLORER</div>
        <h1>WormBase Transcript<br /><em>Sequence Finder</em></h1>
        <p>WormBase transcript ID から、spliced cDNA・CDS・exon 構造を取得します。</p>
        <form onSubmit={fetchTranscript} className="search">
          <label htmlFor="transcript">Transcript ID</label>
          <div className="searchRow">
            <input id="transcript" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. C29A12.4k.1" spellCheck={false} />
            <button disabled={loading}>{loading ? "Fetching…" : "Fetch transcript"}<span aria-hidden>→</span></button>
          </div>
          <small>Try the example: <button type="button" className="example" onClick={() => setId("C29A12.4k.1")}>C29A12.4k.1</button></small>
        </form>
      </header>

      {error && <section className="error" role="alert"><strong>API error</strong><span>{error}</span></section>}
      {loading && <section className="loading" aria-live="polite"><span /> WormBase から注釈と配列を取得しています…</section>}

      {result && <div className="results">
        <section className="summary">
          <div className="sectionHeading"><div><span>01 / OVERVIEW</span><h2>{result.geneName}</h2></div><div className="idPill">{result.transcriptId}</div></div>
          <div className="stats">
            <article><span>Transcript length</span><strong>{result.cdna.length.toLocaleString()}</strong><small>bp · spliced cDNA</small></article>
            <article><span>CDS length</span><strong>{result.cds.length.toLocaleString()}</strong><small>bp · coding sequence</small></article>
            <article><span>Protein length</span><strong>{(result.proteinLength ?? Math.floor(result.cds.length / 3)).toLocaleString()}</strong><small>amino acids</small></article>
            <article><span>Exon count</span><strong>{result.exons.length}</strong><small>annotated exons</small></article>
          </div>
        </section>

        <section className="sequenceSection">
          <div className="sectionHeading"><div><span>02 / SEQUENCES</span><h2>Spliced sequences</h2></div><div className="downloads"><button className="download primaryDownload" onClick={() => saveGenBank(result, "cdna")}>↓ Download annotated cDNA (.gb)</button><button className="download" onClick={() => saveGenBank(result, "cds")}>↓ Download annotated CDS (.gb)</button><button className="download" onClick={() => saveFasta(result)}>↓ Download FASTA</button></div></div>
          <div className="sequenceGrid">
            <article className="seqCard"><div className="seqTop"><div><h3>cDNA</h3><span>{result.cdna.length.toLocaleString()} bp</span></div><button onClick={() => copy("cDNA", result.cdna)}>{copied === "cDNA" ? "Copied ✓" : "Copy cDNA"}</button></div><pre>{wrapSequence(result.cdna)}</pre></article>
            <article className="seqCard"><div className="seqTop"><div><h3>CDS</h3><span>{result.cds.length.toLocaleString()} bp</span></div><button onClick={() => copy("CDS", result.cds)}>{copied === "CDS" ? "Copied ✓" : "Copy CDS"}</button></div><pre>{wrapSequence(result.cds)}</pre></article>
          </div>
        </section>

        <section className="exonSection">
          <div className="sectionHeading"><div><span>03 / EXON MAP</span><h2>Exon coordinates</h2></div><p>WS current · genomic coordinates · {result.exons[0]?.seq_region_name ? `Chromosome ${result.exons[0].seq_region_name}` : ""}</p></div>
          <div className="exonMap">{exonBlocks.map((exon, index) => <span key={exon.id} style={{ flexGrow: Math.max(1, exon.sequence?.length ?? 1) }} title={`Exon ${index + 1}: ${exon.sequence?.length} bp`}>{index + 1}</span>)}</div>
          <div className="tableWrap"><table><thead><tr><th>Exon</th><th>Exon ID</th><th>Genomic coordinates</th><th>Strand</th><th>Length</th><th>Exon sequence (5′ → 3′)</th></tr></thead><tbody>{exonBlocks.map((exon, index) => <tr key={exon.id}><td><b>{String(index + 1).padStart(2, "0")}</b></td><td>{exon.id}</td><td>{exon.seq_region_name}:{exon.start.toLocaleString()}–{exon.end.toLocaleString()}</td><td>{exon.strand === -1 ? "−" : "+"}</td><td>{exon.sequence?.length.toLocaleString()} bp</td><td><code>{exon.sequence}</code></td></tr>)}</tbody></table></div>
        </section>
      </div>}

      <footer><span>Data source: WormBase REST API</span><span>Spliced transcript sequence, not genomic sequence</span></footer>
    </main>
  );
}
