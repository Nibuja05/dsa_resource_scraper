interface RawSource {
	link: string;
	name: string;
	pages: string;
}

interface RawSources {
	main: RawSource[];
	additions: RawSource[];
	references: RawSource[];
}

interface Source {
	name: string;
	pages: number[];
}

interface Sources {
	main: Source[];
	additions: Source[];
	references: Source[];
}

type SourcesKey = keyof Sources;

interface AnalyzeAnswer {
	pages: DocumentPage[] | undefined;
	tables: DocumentTable[] | undefined;
}

interface ParsedPage {
	pdfPage: number;
	page: number;
	title?: string;
	sections: DocumentSection[];
}

type CustomDocumentParagraph =
	import("@azure/ai-form-recognizer").DocumentParagraph & {
		column?: number;
	};

interface DocumentSection {
	name: string;
	isTitle?: boolean;
	paragraphs: CustomDocumentParagraph[];
	bounds: [number, number];
}

type PDFAnalyzeResults = import("@azure/ai-form-recognizer").AnalyzeResult<
	import("@azure/ai-form-recognizer").AnalyzedDocument
>;

interface SavedQuery {
	[name: string]: {
		[page: string]: PDFAnalyzeResults;
	};
}

interface SavedFile {
	[page: number]: string;
}
