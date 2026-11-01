#[derive(Clone, Default)]
pub struct EventHub {
    inner: std::sync::Arc<std::sync::Mutex<EventHubState>>,
}

#[derive(Default)]
struct EventHubState {
    next_sequence: u64,
    events: std::collections::VecDeque<(u64, crate::api::schema::EventEnvelope)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EventHistoryError {
    Lost,
    Unavailable,
}

impl EventHub {
    const MAX_EVENTS: usize = 512;

    pub fn push(&self, event: crate::api::schema::EventEnvelope) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        state.next_sequence += 1;
        let sequence = state.next_sequence;
        state.events.push_back((sequence, event));
        if state.events.len() > Self::MAX_EVENTS {
            state.events.pop_front();
        }
    }

    /// Unchecked history for tests; production callers use `events_after_checked`.
    #[cfg(test)]
    pub fn events_after(&self, sequence: u64) -> Vec<(u64, crate::api::schema::EventEnvelope)> {
        let Ok(state) = self.inner.lock() else {
            return Vec::new();
        };
        Self::retained_after(&state, sequence)
    }

    // Sequences are strictly increasing, so the retained tail is found by binary search.
    fn retained_after(
        state: &EventHubState,
        sequence: u64,
    ) -> Vec<(u64, crate::api::schema::EventEnvelope)> {
        let start = state
            .events
            .partition_point(|(event_sequence, _)| *event_sequence <= sequence);
        state.events.iter().skip(start).cloned().collect()
    }

    pub(super) fn events_after_checked(
        &self,
        sequence: u64,
    ) -> Result<Vec<(u64, crate::api::schema::EventEnvelope)>, EventHistoryError> {
        let state = self
            .inner
            .lock()
            .map_err(|_| EventHistoryError::Unavailable)?;
        if state
            .events
            .front()
            .is_some_and(|(first, _)| sequence < first.saturating_sub(1))
        {
            return Err(EventHistoryError::Lost);
        }
        Ok(Self::retained_after(&state, sequence))
    }

    /// Sequence to resume from after `Lost`: just before the oldest retained event.
    pub(super) fn oldest_resume_sequence(&self) -> u64 {
        let Ok(state) = self.inner.lock() else {
            return 0;
        };
        state
            .events
            .front()
            .map_or(state.next_sequence, |(first, _)| first.saturating_sub(1))
    }

    pub fn current_sequence(&self) -> u64 {
        let Ok(state) = self.inner.lock() else {
            return 0;
        };
        state.next_sequence
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::schema::{EventData, EventEnvelope, EventKind};

    fn event() -> EventEnvelope {
        EventEnvelope {
            event: EventKind::WorkspaceFocused,
            data: EventData::WorkspaceFocused {
                workspace_id: "workspace_1".into(),
            },
        }
    }

    #[test]
    fn checked_history_distinguishes_retained_boundary_from_lost_events() {
        let hub = EventHub::default();
        assert!(hub.events_after_checked(0).unwrap().is_empty());
        for _ in 0..EventHub::MAX_EVENTS {
            hub.push(event());
        }
        assert_eq!(
            hub.events_after_checked(0).unwrap().len(),
            EventHub::MAX_EVENTS
        );
        hub.push(event());
        assert_eq!(hub.events_after_checked(0), Err(EventHistoryError::Lost));
        let retained = hub.events_after_checked(1).unwrap();
        assert_eq!(retained.len(), EventHub::MAX_EVENTS);
        assert_eq!(retained.first().unwrap().0, 2);
        assert_eq!(retained.last().unwrap().0, hub.current_sequence());
        assert!(hub
            .events_after_checked(hub.current_sequence())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn overflow_keeps_newest_events_and_resume_sequence_precedes_oldest() {
        let hub = EventHub::default();
        assert_eq!(hub.oldest_resume_sequence(), 0);
        for _ in 0..EventHub::MAX_EVENTS + 10 {
            hub.push(event());
        }
        assert_eq!(hub.oldest_resume_sequence(), 10);
        let retained = hub.events_after_checked(10).unwrap();
        assert_eq!(retained.len(), EventHub::MAX_EVENTS);
        assert_eq!(retained.first().unwrap().0, 11);
        assert_eq!(retained.last().unwrap().0, hub.current_sequence());
        assert_eq!(
            hub.events_after_checked(11).unwrap().len(),
            EventHub::MAX_EVENTS - 1
        );
        assert_eq!(hub.events_after_checked(9), Err(EventHistoryError::Lost));
    }

    #[test]
    fn checked_history_reports_unavailable_instead_of_empty_after_poison() {
        let hub = EventHub::default();
        assert!(std::panic::catch_unwind(|| {
            let _guard = hub.inner.lock().unwrap();
            panic!("poison the test event history");
        })
        .is_err());
        assert_eq!(
            hub.events_after_checked(0),
            Err(EventHistoryError::Unavailable)
        );
    }
}
