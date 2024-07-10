import lunr from "lunr";
import cosineSimilarity from "compute-cosine-similarity";

process.env.TF_CPP_MIN_LOG_LEVEL = "2";
process.env.TFJS_BACKEND = "tensorflow";

import * as use from "@tensorflow-models/universal-sentence-encoder";
import * as tf from "@tensorflow/tfjs-node";

export function createSearchIndex(documents: DSADocument[]) {
	return lunr(function () {
		this.ref("id");
		this.field("title");
		this.field("body");

		documents.forEach((doc) => {
			this.add({
				title: doc.title,
				body: doc.content,
				id: doc.id,
				source: `${doc.source}: ${doc.sourcePage}`,
			});
		}, this);
	});
}

export function search(query: string, index: lunr.Index) {
	return index.search(query);
}

if (require.main === module) {
	// // Example usage
	// const documents: LunrDocument[] = [
	// 	{ id: "1", text: "The quick brown fox jumps over the lazy dog" },
	// 	{ id: "2", text: "Fast brown dogs jump over lazy foxes" },
	// 	{ id: "3", text: "Lorem ipsum dolor sit amet" },
	// ];
	// const index = createSearchIndex(documents);
	// console.log(index);
	// const results = search("quick brown", index);
	// console.log(results); // This will show the matched documents and their score
}

interface VectorDocument {
	id: string;
	content: string;
	embedding: number[];
	source?: string;
	sourcePage?: number;
}

class MiniVectorDB {
	private documents: VectorDocument[] = [];

	addDocument(
		id: string,
		content: string,
		embedding: number[],
		source?: string,
		sourcePage?: number
	) {
		this.documents.push({ id, content, embedding, source, sourcePage });
	}

	search(
		query: number[],
		topK: number = 5
	): Array<{ document: VectorDocument; score: number }> {
		const scores = this.documents.map((doc) => {
			let score: number;
			try {
				score = cosineSimilarity(query, doc.embedding) ?? 0;
			} catch (error) {
				console.warn(
					`Error calculating similarity for document ${doc.id}:`,
					error
				);
				score = 0;
			}
			return { document: doc, score };
		});

		scores.sort((a, b) => b.score - a.score);
		return scores.slice(0, topK);
	}
}

export async function vectorSearch(query: string, documents: DSADocument[]) {
	await tf.ready();

	const model = await use.load();
	const db = new MiniVectorDB();

	for (const doc of documents) {
		const embedding = await model.embed(doc.content);
		const embeddingArray = Array.from(await embedding.data());
		if (embeddingArray.length !== 512) {
			// Assuming 512 is the expected length
			console.warn(
				`Unexpected embedding length for document ${doc.id}: ${embeddingArray.length}`
			);
		}
		db.addDocument(
			doc.id.toString(),
			doc.content,
			embeddingArray,
			doc.source,
			doc.sourcePage
		);
	}

	const queryEmbedding = await model.embed(query);
	const queryEmbeddingArray = Array.from(await queryEmbedding.data());
	if (queryEmbeddingArray.length !== 512) {
		// Assuming 512 is the expected length
		console.warn(
			`Unexpected query embedding length: ${queryEmbeddingArray.length}`
		);
	}
	const results = db.search(queryEmbeddingArray);

	results.sort((a, b) => b.score - a.score);
	return results;
}
