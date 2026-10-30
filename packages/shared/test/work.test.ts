import { describe, expect, it } from 'vitest';
import { defaultWorkDays, isWorkDay, leaveOverlaps, parseActionItems } from '../src/work';

const members = [
  { userId: 'u1', displayName: 'Amal Hassan' },
  { userId: 'u2', displayName: 'Bassem' },
];

describe('meeting notes → action items', () => {
  it('finds checkbox, TODO and AI lines, with @mentions and an optional due date', () => {
    const notes = `Weekly sync
- Revenue is up 5%
- [ ] Send the deck to the client @Amal by 2026-11-10
[ ] Book the venue @bassem
TODO: update the roadmap
AI: call the supplier @Nobody
- [x] Already done item`;
    expect(parseActionItems(notes, members)).toEqual([
      { title: 'Send the deck to the client', assigneeId: 'u1', dueDay: '2026-11-10' },
      { title: 'Book the venue', assigneeId: 'u2', dueDay: null },
      { title: 'update the roadmap', assigneeId: null, dueDay: null },
      { title: 'call the supplier @Nobody', assigneeId: null, dueDay: null },
    ]);
  });
  it('works with Arabic notes', () => {
    expect(parseActionItems('- [ ] ابعت العرض للعميل @Bassem', members)).toEqual([{ title: 'ابعت العرض للعميل', assigneeId: 'u2', dueDay: null }]);
  });
});

describe('work days and leave', () => {
  it('Egypt and Saudi work Sunday–Thursday; elsewhere Monday–Friday', () => {
    expect(defaultWorkDays('Africa/Cairo')).toEqual([0, 1, 2, 3, 4]);
    expect(defaultWorkDays('Europe/London')).toEqual([1, 2, 3, 4, 5]);
    expect(isWorkDay('2026-11-06', [0, 1, 2, 3, 4])).toBe(false); // Friday
    expect(isWorkDay('2026-11-08', [0, 1, 2, 3, 4])).toBe(true); // Sunday
  });
  it('leave ranges overlap when they share a day', () => {
    expect(leaveOverlaps({ startDay: '2026-11-01', endDay: '2026-11-05' }, { startDay: '2026-11-05', endDay: '2026-11-07' })).toBe(true);
    expect(leaveOverlaps({ startDay: '2026-11-01', endDay: '2026-11-04' }, { startDay: '2026-11-05', endDay: '2026-11-07' })).toBe(false);
  });
});
