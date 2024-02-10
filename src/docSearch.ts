import lunr from "lunr";

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
