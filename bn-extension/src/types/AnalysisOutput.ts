
// TODO the type that analyzers output
type AnalysisOutput = {  
    tags: string[];
    score: number;
    explanation: string;
    confidence: number;
};

type BiasAnalyzerOutput = AnalysisOutput & {
    biasDirection: "left" | "right" | "no-political-leaning";
}
