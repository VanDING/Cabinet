import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeetingCard, type MeetingData } from '../components/MeetingCard';

const baseData: MeetingData = {
  meetingId: 'meeting-1',
  topic: 'Q3 Strategy Discussion',
  synthesis: 'The cabinet recommends entering the母婴 market.',
  perspectives: [
    { advisor: 'Market Analyst', role: 'Analyst', content: 'Market size growing 15% YoY.' },
    { advisor: 'Risk Manager', role: 'Risk', content: 'Regulatory risk is moderate.' },
  ],
  crossValidation: {
    agreements: ['Market is growing'],
    disagreements: ['Timing of entry'],
    gaps: ['No competitor analysis'],
    contradictions: [],
    coherenceScore: 0.72,
  },
  decisionId: 'dec-123',
};

describe('MeetingCard', () => {
  it('renders topic and coherence score', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText('Q3 Strategy Discussion')).toBeInTheDocument();
    expect(screen.getByText('Coherence: 72%')).toBeInTheDocument();
  });

  it('shows Meeting label', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText('Meeting')).toBeInTheDocument();
  });

  it('renders advisor perspectives expanded by default', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText('Advisor Perspectives (2)')).toBeInTheDocument();
    expect(screen.getByText('Market Analyst')).toBeInTheDocument();
    expect(screen.getByText('Market size growing 15% YoY.')).toBeInTheDocument();
  });

  it('renders chair synthesis', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText('Chair Synthesis')).toBeInTheDocument();
    expect(screen.getByText('The cabinet recommends entering the母婴 market.')).toBeInTheDocument();
  });

  it('collapses content on header click', () => {
    render(<MeetingCard data={baseData} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.queryByText('Advisor Perspectives (2)')).not.toBeInTheDocument();
  });

  it('shows cross-validation disagreements, gaps, and agreements', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText('Disagreements:')).toBeInTheDocument();
    expect(screen.getByText('Timing of entry')).toBeInTheDocument();
    expect(screen.getByText('Gaps:')).toBeInTheDocument();
    expect(screen.getByText('No competitor analysis')).toBeInTheDocument();
    expect(screen.getByText('Agreements:')).toBeInTheDocument();
    expect(screen.getByText('Market is growing')).toBeInTheDocument();
  });

  it('shows green for high coherence (>= 0.7)', () => {
    render(<MeetingCard data={baseData} />);
    const score = screen.getByText('Coherence: 72%');
    expect(score.className).toContain('text-green');
  });

  it('shows amber for medium coherence (>= 0.5, < 0.7)', () => {
    const midData = {
      ...baseData,
      crossValidation: { ...baseData.crossValidation!, coherenceScore: 0.55 },
    };
    render(<MeetingCard data={midData} />);
    const score = screen.getByText('Coherence: 55%');
    expect(score.className).toContain('text-amber');
  });

  it('shows red for low coherence (< 0.5)', () => {
    const lowData = {
      ...baseData,
      crossValidation: { ...baseData.crossValidation!, coherenceScore: 0.3 },
    };
    render(<MeetingCard data={lowData} />);
    const score = screen.getByText('Coherence: 30%');
    expect(score.className).toContain('text-red');
  });

  it('renders without crossValidation gracefully', () => {
    const minimal = { ...baseData, crossValidation: null };
    render(<MeetingCard data={minimal} />);
    expect(screen.getByText('Q3 Strategy Discussion')).toBeInTheDocument();
    expect(screen.queryByText('Coherence:')).not.toBeInTheDocument();
  });

  it('shows decision auto-extraction notice when decisionId present', () => {
    render(<MeetingCard data={baseData} />);
    expect(screen.getByText(/dec-123/)).toBeInTheDocument();
    expect(screen.getByText(/auto-extracted/)).toBeInTheDocument();
  });

  it('hides decision notice when decisionId is absent', () => {
    const noDecision = { ...baseData, decisionId: null };
    render(<MeetingCard data={noDecision} />);
    expect(screen.queryByText(/auto-extracted/)).not.toBeInTheDocument();
  });

  it('includes dark mode classes via Tailwind dark: prefix', () => {
    const { container } = render(<MeetingCard data={baseData} />);
    const outerDiv = container.firstChild as HTMLElement;
    // Dark mode classes are always present via Tailwind dark: prefix
    expect(outerDiv.className).toContain('dark:border-gray-700');
    expect(outerDiv.className).toContain('dark:bg-gray-800/80');
  });

  it('renders without perspectives gracefully', () => {
    const noPerspectives = { ...baseData, perspectives: [] };
    render(<MeetingCard data={noPerspectives} />);
    expect(screen.getByText('Q3 Strategy Discussion')).toBeInTheDocument();
    expect(screen.queryByText('Advisor Perspectives')).not.toBeInTheDocument();
  });
});
