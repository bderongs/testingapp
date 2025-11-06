// This file provides a modal component for editing Playwright tests by modifying baseline assertions using AI.
'use client';

import { useState } from 'react';
import { X, Wand2, Loader2, CheckCircle2, AlertCircle, Code, Eye, EyeOff } from 'lucide-react';

interface TestEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  specSlug: string;
  storyTitle: string;
  baselineAssertions: readonly string[];
}

interface EditResponse {
  success: boolean;
  original?: string[];
  modified?: string[];
  message?: string;
  error?: string;
  backupPath?: string;
}

export const TestEditModal = ({ isOpen, onClose, specSlug, storyTitle, baselineAssertions }: TestEditModalProps) => {
  const [instruction, setInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<EditResponse | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expertMode, setExpertMode] = useState(false);
  const [playwrightCode, setPlaywrightCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const loadPlaywrightCode = async () => {
    if (playwrightCode) return;
    try {
      const response = await fetch(`/api/spec/${specSlug}`);
      if (response.ok) {
        const code = await response.text();
        setPlaywrightCode(code);
      }
    } catch {
      // Ignore errors
    }
  };

  const handlePreview = async () => {
    if (!instruction.trim()) {
      setError('Please enter an instruction');
      return;
    }

    setIsLoading(true);
    setError(null);
    setPreview(null);

    try {
      const response = await fetch(`/api/test/${specSlug}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim(), apply: false, baselineAssertions }),
      });

      const data = (await response.json()) as EditResponse;
      if (data.success && data.modified) {
        setPreview(data);
      } else {
        setError(data.error || data.message || 'Failed to generate preview');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    if (!instruction.trim() || !preview || !preview.modified) return;

    setIsApplying(true);
    setError(null);

    try {
      const response = await fetch(`/api/test/${specSlug}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction.trim(), apply: true, baselineAssertions: preview.modified }),
      });

      const data = (await response.json()) as EditResponse;
      if (data.success) {
        // Close modal and refresh page to show updated test
        onClose();
        window.location.reload();
      } else {
        setError(data.error || data.message || 'Failed to apply changes');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const handleReset = () => {
    setInstruction('');
    setPreview(null);
    setError(null);
  };

  if (expertMode && !playwrightCode) {
    loadPlaywrightCode();
  }

  const currentAssertions = preview?.modified || baselineAssertions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <Wand2 className="h-5 w-5 text-sparkier-primary" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Edit Test with AI</h2>
              <p className="text-xs text-slate-600">{storyTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setExpertMode(!expertMode);
                if (!expertMode) loadPlaywrightCode();
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
            >
              {expertMode ? <EyeOff className="h-4 w-4" /> : <Code className="h-4 w-4" />}
              {expertMode ? 'Hide Code' : 'Expert Mode'}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col overflow-hidden" style={{ height: 'calc(90vh - 80px)' }}>
          {/* Instruction Input */}
          <div className="border-b border-slate-200 bg-white p-6">
            <label htmlFor="instruction" className="block text-sm font-medium text-slate-700 mb-2">
              What would you like to change?
            </label>
            <div className="flex gap-2">
              <input
                id="instruction"
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                    e.preventDefault();
                    handlePreview();
                  }
                }}
                placeholder="e.g., remove the navigation link check, change the CTA to 'Login' instead, add a check for the page title"
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-sparkier-primary focus:outline-none focus:ring-2 focus:ring-sparkier-primary/20"
                disabled={isLoading || isApplying}
              />
              <button
                onClick={handlePreview}
                disabled={isLoading || isApplying || !instruction.trim()}
                className="rounded-lg bg-sparkier-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-sparkier-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Preview'
                )}
              </button>
            </div>
            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>

          {/* Preview/Assertions */}
          <div className="flex-1 overflow-auto bg-slate-50 p-6">
            {expertMode && playwrightCode ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-700">Playwright Test Code (Expert Mode)</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <pre className="p-4 text-xs font-mono">
                      <code className="text-slate-800">{playwrightCode}</code>
                    </pre>
                  </div>
                </div>
              </div>
            ) : preview ? (
              <div className="space-y-4">
                {/* Assertions Comparison */}
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-700">Baseline Assertions</h3>
                    <p className="text-xs text-slate-600 mt-1">These are the checks that will be validated</p>
                  </div>
                  <div className="p-4 space-y-2">
                    {currentAssertions.map((assertion, index) => {
                      const wasModified = preview.original && preview.original[index] !== assertion;
                      const wasRemoved = preview.original && !currentAssertions.includes(preview.original[index]);
                      const isNew = !preview.original || !preview.original.includes(assertion);

                      return (
                        <div
                          key={index}
                          className={`flex items-start gap-3 rounded-lg border p-3 ${
                            wasModified || isNew
                              ? 'border-emerald-300 bg-emerald-50'
                              : wasRemoved
                              ? 'border-red-300 bg-red-50'
                              : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {wasModified || isNew ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : wasRemoved ? (
                              <X className="h-4 w-4 text-red-600" />
                            ) : (
                              <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
                            )}
                          </div>
                          <p className="flex-1 text-sm text-slate-700">{assertion}</p>
                        </div>
                      );
                    })}
                    {preview.original &&
                      preview.original
                        .filter((a) => !currentAssertions.includes(a))
                        .map((removedAssertion, index) => (
                          <div
                            key={`removed-${index}`}
                            className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3 opacity-60"
                          >
                            <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="flex-1 text-sm text-slate-700 line-through">{removedAssertion}</p>
                          </div>
                        ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={handleReset}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    disabled={isApplying}
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleApply}
                    disabled={isApplying}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isApplying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Apply Changes
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Current Assertions */}
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-700">Current Baseline Assertions</h3>
                    <p className="text-xs text-slate-600 mt-1">These checks will be validated when the test runs</p>
                  </div>
                  <div className="p-4 space-y-2">
                    {baselineAssertions.map((assertion, index) => (
                      <div key={index} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
                        </div>
                        <p className="flex-1 text-sm text-slate-700">{assertion}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex h-full items-center justify-center text-center">
                  <div className="text-slate-400">
                    <Wand2 className="mx-auto h-12 w-12 mb-3 opacity-50" />
                    <p className="text-sm">Enter an instruction and click Preview to see changes</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
