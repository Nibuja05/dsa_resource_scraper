import fs from "fs-extra";
import os from "os";
import path from "path";
import { stringSimilarity } from "string-similarity-js";

export function checkStringInclude(str: string, list: string[]) {
	str = str.toLowerCase();
	function preReturnFilter(resultList: string[]) {
		return resultList
			.filter((result) => !result.toLowerCase().includes("errata"))
			.map((result) => list.indexOf(result));
	}

	let results = [];
	for (const item of list) {
		if (
			item.toLowerCase().includes(str) ||
			str.includes(item.toLowerCase())
		)
			results.push(item);
	}
	if (results.length > 0) {
		return preReturnFilter(results);
	}

	const parts = str.split(/\s+/);
	let maxParts = 0;
	for (const item of list) {
		const count = parts.filter((part) =>
			item.toLowerCase().includes(part)
		).length;
		if (count >= maxParts) {
			if (count > maxParts) results = [];
			maxParts = count;
			results.push(item);
		}
	}

	console.log(
		`Best finds with ${maxParts}/${parts.length} matching parts:`,
		results
	);
	return preReturnFilter(results);
}

export function stringSimilarityOfList(
	str: string,
	list: string[],
	indexList?: number[]
) {
	if (indexList) {
		list = indexList.map((i) => list[i]);
	}
	console.log("search for:", list);
	return list.map((item) => stringSimilarity(str, item));
}

export async function checkAndUpdateCache<T extends Record<string, any>, S>(
	name: string,
	callback: (data: T, update: (newData: T) => void) => S
): Promise<S> {
	const userHome = os.homedir();
	const filePath = path.join(
		userHome,
		"Documents",
		"DSASuche",
		`${name}.json`
	);

	// Ensure directory exists
	await fs.ensureDir(path.dirname(filePath));

	let data = await fs.readJson(filePath).catch(() => ({}));
	const result = callback(data, (newData) => {
		fs.writeJson(filePath, newData, { spaces: 2 }).catch(console.error);
	});

	return result;
}

export function splitStringWithSeparator(
	input: string,
	separator: string
): string[] {
	return input
		.split(separator)
		.filter((part) => part !== "")
		.map((val, index) => (index > 0 ? `${separator}${val}` : val));
}

export function estimateTokenCount(text: string): number {
	// Rough estimation: 1 token per 4 characters
	const averageCharsPerToken = 4;
	return Math.ceil(text.length / averageCharsPerToken);
}

// For your use case, you can sum the tokens of all inputs
export function estimateTotalTokens(
	instruction: string,
	phrase: string,
	sourceDocuments: Array<string>
): number {
	let totalLength =
		estimateTokenCount(instruction) + estimateTokenCount(phrase);
	sourceDocuments.forEach((doc) => {
		totalLength += estimateTokenCount(doc);
	});
	return totalLength;
}
