import { OnlyOfficeEditorShell } from "@/components/editor/OnlyOfficeEditorShell";

export default async function EditorPage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;
  return <OnlyOfficeEditorShell fileId={fileId} />;
}
