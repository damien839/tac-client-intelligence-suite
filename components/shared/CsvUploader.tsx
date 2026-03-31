"use client";

import { useCallback, useState } from "react";

interface CsvUploaderProps {
  label: string;
  description?: string;
  onUpload: (csvText: string, fileName: string) => void;
  accept?: string;
}

export default function CsvUploader({
  label,
  description,
  onUpload,
  accept = ".csv",
}: CsvUploaderProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        onUpload(text, file.name);
      };
      reader.readAsText(file);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      className={`card cursor-pointer transition-all ${
        isDragging ? "border-tac-accent bg-tac-accent/5" : "hover:border-tac-accent/50"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) handleFile(file);
        };
        input.click();
      }}
    >
      <div className="text-center py-4">
        <div className="text-3xl mb-2">📄</div>
        <p className="font-medium text-tac-text">{label}</p>
        {description && (
          <p className="text-sm text-tac-muted mt-1">{description}</p>
        )}
        {fileName ? (
          <p className="text-sm text-tac-accent mt-2">✓ {fileName}</p>
        ) : (
          <p className="text-sm text-tac-muted mt-2">
            Drop CSV here or click to browse
          </p>
        )}
      </div>
    </div>
  );
}
