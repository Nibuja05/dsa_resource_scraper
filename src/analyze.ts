import {
	AzureKeyCredential,
	DocumentAnalysisClient,
	DocumentParagraph,
	DocumentTable,
} from "@azure/ai-form-recognizer";
import * as dotenv from "dotenv";
dotenv.config();

import fs from "fs-extra";
import { PDFDocument } from "pdf-lib";

const FILE_NAME = "Liber Cantiones";
const PAGE_NUMBER = 102;

async function extractPage(
	filePath: string,
	pageNum: number
): Promise<Uint8Array> {
	const existingPdfBytes = fs.readFileSync(filePath);
	const pdfDoc = await PDFDocument.load(existingPdfBytes);
	const newPdfDoc = await PDFDocument.create();
	const [extractedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum]);
	newPdfDoc.addPage(extractedPage);
	return await newPdfDoc.save();
}

async function getPageContent(name: string, page: number) {
	const filePath = "./res/downloaded.json";
	let saved: SavedQuery = {};
	if (fs.existsSync(filePath)) {
		saved = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SavedQuery;
		if (name in saved && page in saved[name]) {
			return saved[name][page];
		}
	} else {
		fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
	}

	const client = new DocumentAnalysisClient(
		process.env.AZURE_ENDPOINT!,
		new AzureKeyCredential(process.env.AZURE_KEY!)
	);
	const input = await extractPage(`./res/${name}.pdf`, page);

	const poller = await client.beginAnalyzeDocument("prebuilt-layout", input);
	const data = await poller.pollUntilDone();

	if (!(name in saved)) {
		saved[name] = {};
	}
	saved[name][page] = data;
	fs.writeFileSync(filePath, JSON.stringify(saved, null, 2));
	return data;
}

async function main() {
	const name = FILE_NAME;
	const pageNumber = PAGE_NUMBER;
	const content = await getPageContent(name, pageNumber);

	if (content.paragraphs) {
		let paragraphs = content.paragraphs;
		if (content.tables) {
			paragraphs = filterOutTables(paragraphs, content.tables);
		}
		const page = parsePage(paragraphs, pageNumber);

		let text = "";

		const cleanTitle = (title: string) =>
			title.replaceAll("İ", "I").replaceAll("V", "U");
		const cleanText = (text: string) =>
			text.replaceAll(/(?<=\w)- (?=\w)/g, "");

		for (const section of page.sections) {
			if (section.isTitle) {
				text += `\n\n# ${cleanTitle(section.name)}\n\n`;
			} else {
				text += `\n## ${cleanTitle(section.name)}\n\n`;
			}
			for (const paragraph of section.paragraphs) {
				text += `${paragraph.content}\n`;
			}
			text = cleanText(text);
		}

		text = `Seite ${page}:\n\n${text}`;
		console.log(text);
	}
}

function filterOutTables(
	paragraphs: DocumentParagraph[],
	tables: DocumentTable[]
) {
	let newParagraphs: DocumentParagraph[] = [];

	for (const paragraph of paragraphs) {
		const pXMin = paragraph.boundingRegions![0].polygon![0].x;
		const pXMax = paragraph.boundingRegions![0].polygon![2].x;
		const pYMin = paragraph.boundingRegions![0].polygon![0].y;
		const pYMax = paragraph.boundingRegions![0].polygon![2].y;

		let shouldAdd = true;

		for (const table of tables) {
			for (const cell of table.cells) {
				const cXMin = cell.boundingRegions![0].polygon![0].x;
				const cXMax = cell.boundingRegions![0].polygon![2].x;
				const cYMin = cell.boundingRegions![0].polygon![0].y;
				const cYMax = cell.boundingRegions![0].polygon![2].y;

				if (
					pXMin == cXMin &&
					pXMax == cXMax &&
					pYMin == cYMin &&
					pYMax == cYMax
				) {
					console.log("Same!");
					shouldAdd = false;
				}
			}
		}

		if (shouldAdd) newParagraphs.push(paragraph);
	}

	return newParagraphs;
}

function parsePage(
	paragraphs: DocumentParagraph[],
	page: number,
	lastTitle?: string
): ParsedPage {
	let filteredParagraphs = paragraphs.filter(
		(p) => p.boundingRegions && p.boundingRegions[0].polygon
	);

	function sortIntoColums(paragraphs: CustomDocumentParagraph[]) {
		let sortedParagraphs: CustomDocumentParagraph[] = [];

		// Identify columns based on significant jumps in x-coordinate
		let currentColumn: CustomDocumentParagraph[] = [];
		let columnIndex = 1;
		let lastXMax = 0;

		// Sort by x-coordinate
		paragraphs.sort(
			(a, b) =>
				a.boundingRegions![0].polygon![0].x -
				b.boundingRegions![0].polygon![0].x
		);

		for (const paragraph of paragraphs) {
			if (paragraph.role === "title") {
				paragraph.column = columnIndex;
				currentColumn.push(paragraph);
				continue;
			}
			const xMin = paragraph.boundingRegions![0].polygon![0].x;
			if (xMin > lastXMax) {
				currentColumn.sort(
					(a, b) =>
						a.boundingRegions![0].polygon![0].y -
						b.boundingRegions![0].polygon![0].y
				);
				sortedParagraphs = [...sortedParagraphs, ...currentColumn];
				paragraph.column = columnIndex;
				currentColumn = [paragraph];
				lastXMax = paragraph.boundingRegions![0].polygon![1].x;
			} else {
				paragraph.column = columnIndex;
				currentColumn.push(paragraph);
			}
		}

		currentColumn.sort(
			(a, b) =>
				a.boundingRegions![0].polygon![0].y -
				b.boundingRegions![0].polygon![0].y
		);
		sortedParagraphs = [...sortedParagraphs, ...currentColumn];
		return sortedParagraphs;
	}

	function splitAndSort(filteredParagraphs: DocumentParagraph[]): ParsedPage {
		let title: string | undefined;
		let lastTitleCandidate: string | undefined;
		let actualPage: number | undefined;

		// Correct major header detection
		const majorHeaders: DocumentParagraph[] = [];
		filteredParagraphs = filteredParagraphs.filter((p) => {
			if (p.role === "pageNumber") {
				actualPage = parseInt(p.content);
				return false;
			}
			if (p.role === "title") {
				if (lastTitleCandidate && lastTitleCandidate === p.content) {
					title = lastTitleCandidate;
				} else {
					lastTitleCandidate = p.content;
				}

				const yMin = p.boundingRegions![0].polygon![0].y;
				if (yMin >= 0.5) {
					majorHeaders.push(p);
				} else return false;
			}
			if (p.role === "sectionHeading") {
				const yMin = p.boundingRegions![0].polygon![0].y;
				const yMax = p.boundingRegions![0].polygon![2].y;

				const overlapping = filteredParagraphs.some((otherP) => {
					if (otherP === p || otherP.role === "sectionHeading")
						return false;
					const otherYMin = otherP.boundingRegions![0].polygon![0].y;
					const otherYMax = otherP.boundingRegions![0].polygon![2].y;
					return otherYMin <= yMax && otherYMax >= yMin;
				});

				if (!overlapping) {
					majorHeaders.push(p);
				}
			}
			return true;
		});

		majorHeaders.sort(
			(a, b) =>
				a.boundingRegions![0].polygon![0].y -
				b.boundingRegions![0].polygon![0].y
		);

		let sections: DocumentSection[] = [];
		let lastYMax = 0;
		let lastHeader: DocumentParagraph | undefined;

		for (const majorHeader of majorHeaders) {
			const yMin = majorHeader.boundingRegions![0].polygon![0].y;
			let bounds: [number, number] = [999, 0];
			const section = filteredParagraphs.filter((p) => {
				const pYMin = p.boundingRegions![0].polygon![0].y;
				const pYMax = p.boundingRegions![0].polygon![2].y;
				if (pYMin >= lastYMax && pYMin < yMin) {
					if (pYMin < bounds[0]) bounds[0] = pYMin;
					if (pYMax > bounds[1]) bounds[1] = pYMax;
					return true;
				}
			});

			const paragraphs = sortIntoColums(section);
			if (paragraphs.length > 0) {
				let curSection: DocumentSection = {
					name: lastTitle ?? "",
					paragraphs: paragraphs,
					bounds,
				};
				if (lastHeader && lastHeader.role === "title") {
					curSection.isTitle = true;
				}
				sections.push(curSection);
			}

			// sortedParagraphs = [...sortedParagraphs, ...currentColumn, majorHeader];
			lastTitle = majorHeader.content;
			lastHeader = majorHeader;
			lastYMax = majorHeader.boundingRegions![0].polygon![2].y;
		}

		// Include paragraphs after the last major header
		let bounds: [number, number] = [999, 0];
		const lastSection = filteredParagraphs.filter((p) => {
			const pYMin = p.boundingRegions![0].polygon![0].y;
			const pYMax = p.boundingRegions![0].polygon![2].y;
			if (pYMin >= lastYMax) {
				if (pYMin < bounds[0]) bounds[0] = pYMin;
				if (pYMax > bounds[1]) bounds[1] = pYMax;
				return true;
			}
		});
		let curSection: DocumentSection = {
			name: lastTitle ?? "",
			paragraphs: sortIntoColums(lastSection),
			bounds,
		};
		if (lastHeader && lastHeader.role === "title") {
			curSection.isTitle = true;
		}
		if (curSection.paragraphs.length > 0) sections.push(curSection);

		return {
			pdfPage: page,
			page: actualPage ?? page,
			title,
			sections,
		};
	}

	function sortAndParse(filteredParagraphs: DocumentParagraph[]): ParsedPage {
		let title: string | undefined;
		let lastTitleCandidate: string | undefined;
		let actualPage: number | undefined;

		let sortedParagraphs = sortIntoColums(filteredParagraphs);

		// Correct major header detection
		const majorHeaders: DocumentParagraph[] = [];
		sortedParagraphs = sortedParagraphs.filter((p) => {
			if (p.role === "pageNumber") {
				actualPage = parseInt(p.content);
				return false;
			}
			if (p.role === "title") {
				if (lastTitleCandidate && lastTitleCandidate === p.content) {
					title = lastTitleCandidate;
				} else {
					lastTitleCandidate = p.content;
				}

				const yMin = p.boundingRegions![0].polygon![0].y;
				if (yMin >= 0.5) {
					majorHeaders.push(p);
				} else return false;
			}
			if (p.role === "sectionHeading") {
				majorHeaders.push(p);
			}
			return true;
		});

		let sections: DocumentSection[] = [];
		let lastHeader: DocumentParagraph | undefined;

		let sectionedParagraphs: Array<
			[DocumentParagraph | undefined, DocumentParagraph[]]
		> = [];
		let tempSection: DocumentParagraph[] = [];
		for (const paragraph of sortedParagraphs) {
			if (majorHeaders.includes(paragraph)) {
				sectionedParagraphs.push([paragraph, tempSection]);
				tempSection = [];
			} else {
				tempSection.push(paragraph);
			}
		}
		sectionedParagraphs.push([undefined, tempSection]);

		for (const [majorHeader, paragraphs] of sectionedParagraphs) {
			let bounds: [number, number] = [999, 0];
			sortedParagraphs.forEach((p) => {
				const pYMin = p.boundingRegions![0].polygon![0].y;
				const pYMax = p.boundingRegions![0].polygon![2].y;

				if (pYMin < bounds[0]) bounds[0] = pYMin;
				if (pYMax > bounds[1]) bounds[1] = pYMax;
			});

			if (paragraphs.length > 1) {
				let curSection: DocumentSection = {
					name: lastTitle ?? "",
					paragraphs: paragraphs,
					bounds,
				};
				if (lastHeader && lastHeader.role === "title") {
					curSection.isTitle = true;
				}
				sections.push(curSection);
			}

			if (majorHeader) {
				lastTitle = majorHeader.content;
				lastHeader = majorHeader;
			}
		}

		return {
			pdfPage: page,
			page: actualPage ?? page,
			title,
			sections,
		};
	}

	let parsedPage = splitAndSort(filteredParagraphs);
	if (parsedPage.sections.length < 2) {
		parsedPage = sortAndParse(filteredParagraphs);
	}

	return parsedPage;
}

main().catch((error) => {
	console.error("An error occurred:", error);
	process.exit(1);
});
