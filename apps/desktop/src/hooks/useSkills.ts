import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

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

  useEffect(() => {
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
  }, []);

  return skills;
}
