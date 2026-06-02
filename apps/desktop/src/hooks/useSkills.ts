import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/api.js';

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  status: string;
}

export function useSkills(): SkillInfo[] {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const fetchSkills = () => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.skills?.length > 0) {
          setSkills(d.skills);
        }
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-skills');
          if (raw) {
            const parsed = JSON.parse(raw);
            setSkills(Array.isArray(parsed) ? parsed : []);
          }
        } catch {
          /* localStorage fallback parse error */
        }
      });
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  useEffect(() => {
    const handler = () => fetchSkills();
    window.addEventListener('ws:skill_created', handler);
    window.addEventListener('ws:skill_updated', handler);
    window.addEventListener('ws:skill_deleted', handler);
    return () => {
      window.removeEventListener('ws:skill_created', handler);
      window.removeEventListener('ws:skill_updated', handler);
      window.removeEventListener('ws:skill_deleted', handler);
    };
  }, []);

  return skills;
}
