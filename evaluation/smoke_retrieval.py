"""Small real-model integration check; this is not a retrieval benchmark.

Run from the project root: python -m evaluation.smoke_retrieval
First run downloads public model weights. After caching, optionally set
HF_HUB_OFFLINE=1 to verify that the same check works without Hub access.
"""
from pathlib import Path

from src.chunker import chunk_document
from src.document_loader import load_document
from src.retriever import SearchEngine


def main():
    samples = Path(__file__).resolve().parents[1] / "sample_data"
    chunks = tuple(
        chunk
        for name in ("dbms_notes.pdf", "cloud_computing.txt")
        for chunk in chunk_document(load_document(name, (samples / name).read_bytes()))
    )
    engine = SearchEngine()
    try:
        print(f"Indexed {engine.build(chunks)} sample chunks.")
        cases = [
            ("What reduces redundancy in relational tables?", "dbms_notes.pdf", 1),
            ("Who manages the operating system in IaaS?", "cloud_computing.txt", None),
            ("What are the symptoms of influenza?", None, None),
        ]
        for question, filename, page in cases:
            hits = engine.search(question, k=3)
            if filename is None:
                assert not hits, "Unrelated smoke query unexpectedly returned a match."
            else:
                assert hits, "Expected smoke query returned no passages."
                assert (hits[0].chunk.filename, hits[0].chunk.page_number) == (filename, page)
            print(question)
            print([(hit.chunk.filename, hit.chunk.page_number, round(hit.similarity, 3)) for hit in hits])
        print("Smoke checks passed. These examples do not measure general retrieval quality.")
    finally:
        engine.clear()


if __name__ == "__main__":
    main()
