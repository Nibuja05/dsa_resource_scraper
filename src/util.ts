import fs from "fs-extra";
import os from "os";
import path from "path";
import { stringSimilarity } from "string-similarity-js";

export function stringSimilarityOfList(str: string, list: string[]) {
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
