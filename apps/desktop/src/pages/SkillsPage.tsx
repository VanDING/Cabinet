import React, { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface SkillItem {
  id: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  status: string;
}

interface TestResult {
  output: string;
  error?: string;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '', kind: 'tool', promptTemplate: '' });
  const [testSkillId, setTestSkillId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    try {
      const res = await apiFetch('/api/skills', { headers: authHeaders() });
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch {}
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    try {
      const res = await apiFetch('/api/skills', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data.status === 'registered') {
        setMessage(`Skill "${formData.name}" registered.`);
        setShowForm(false);
        setFormData({ name: '', description: '', kind: 'tool', promptTemplate: '' });
        fetchSkills();
      }
    } catch {}
  };

  const handleTest = async (skillId: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch(`/api/skills/${skillId}/test`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ input: testInput }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ output: '', error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const kindColors: Record<string, string> = {
    tool: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    prompt: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    composite: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Skills</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage atomic AI capabilities</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setMessage(''); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Skill'}
        </button>
      </div>

      {message && (
        <div className="mb-4 px-4 py-2 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          {message}
          <button onClick={() => setMessage('')} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Register New Skill</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Market Analysis"
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                placeholder="What does this skill do?"
                rows={2}
                className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Kind</label>
                <select
                  value={formData.kind}
                  onChange={(e) => setFormData(p => ({ ...p, kind: e.target.value }))}
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="tool">Tool</option>
                  <option value="prompt">Prompt</option>
                  <option value="composite">Composite</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Prompt Template</label>
                <input
                  type="text"
                  value={formData.promptTemplate}
                  onChange={(e) => setFormData(p => ({ ...p, promptTemplate: e.target.value }))}
                  placeholder="e.g. Analyze {{topic}}"
                  className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={!formData.name.trim()}
              className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Register Skill
            </button>
          </div>
        </div>
      )}

      {/* Skill List */}
      {skills.length === 0 ? (
        <div className="text-center text-gray-400 dark:text-gray-500 py-12">
          <p className="text-lg">No skills registered</p>
          <p className="text-sm mt-1">Create your first skill to extend AI capabilities.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map(skill => (
            <div key={skill.id} className="border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{skill.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${kindColors[skill.kind] ?? 'bg-gray-100'}`}>
                        {skill.kind}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        skill.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                        skill.status === 'draft' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {skill.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{skill.description}</p>
                    <p className="text-xs text-gray-400 mt-1">v{skill.version}</p>
                  </div>
                </div>
                <button
                  onClick={() => setTestSkillId(testSkillId === skill.id ? null : skill.id)}
                  className="px-3 py-1.5 text-sm border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  {testSkillId === skill.id ? 'Close' : 'Test'}
                </button>
              </div>

              {testSkillId === skill.id && (
                <div className="border-t dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-2">Test Input</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      placeholder="Enter test input..."
                      className="flex-1 border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleTest(skill.id)}
                      disabled={testing}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {testing ? 'Testing...' : 'Run'}
                    </button>
                  </div>
                  {testResult && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${
                      testResult.error
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                        : 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                    }`}>
                      <div className="font-medium mb-1">{testResult.error ? 'Error' : 'Output'}:</div>
                      <pre className="whitespace-pre-wrap font-mono text-xs">{testResult.error ?? testResult.output}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
