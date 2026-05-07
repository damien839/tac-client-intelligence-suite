import { notFound } from "next/navigation";
import Nav from "@/components/shared/Nav";
import { getAnalysis } from "@/lib/actions/freight-analyses";
import ReportRenderer from "@/components/final-mile/report/ReportRenderer";
import type { AnalyzerReport } from "@/lib/analyzer/report-types";

interface ReportPageProps {
  params: { id: string };
}

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: ReportPageProps) {
  const record = await getAnalysis(params.id);
  if (!record) notFound();

  const report = record.report_json as AnalyzerReport;

  return (
    <>
      <Nav />
      <ReportRenderer
        report={report}
        generatedAt={record.created_at}
        analysisId={record.id}
      />
    </>
  );
}
