//! Characterisation tests for `snapshot_with_completions`. `legacy_snapshot_with_completions`
//! is a verbatim copy of the pre-refactor builder; it is the oracle for struct and
//! bincode byte equality across adversarial identity state and client locations.

use super::snapshot_with_completions;
use crate::app;
use crate::protocol;
use crate::server::clients::ClientShellLocation;

fn legacy_snapshot_with_completions(
    app: &app::App,
    boot_id: &str,
    revision: u64,
    config_diagnostic: Option<&str>,
    location: Option<&ClientShellLocation>,
) -> (
    protocol::ClientShellSnapshot,
    protocol::endpoint::EndpointAgentCompletions,
) {
    let snapshot = app.session_snapshot();
    let completions = protocol::endpoint::EndpointAgentCompletions {
        boot_id: boot_id.to_owned(),
        revision,
        completions: snapshot
            .agents
            .iter()
            .filter_map(|agent| agent.completion_seq.map(|seq| (agent.pane_id.clone(), seq)))
            .collect(),
    };
    let focused_workspace_id = location
        .and_then(|location| location.focused_workspace_id.clone())
        .or_else(|| snapshot.focused_workspace_id.clone());
    let focused_tab_id = location
        .and_then(|location| location.focused_tab_id().map(str::to_owned))
        .or_else(|| snapshot.focused_tab_id.clone());
    let focused_pane_id = focused_tab_id
        .as_deref()
        .and_then(|tab_id| app.parse_tab_id(tab_id))
        .and_then(|(workspace_index, tab_index)| {
            let pane_id = app
                .state
                .workspaces
                .get(workspace_index)?
                .tabs
                .get(tab_index)?
                .layout
                .focused();
            app.public_pane_id(workspace_index, pane_id)
        })
        .or_else(|| snapshot.focused_pane_id.clone());
    let workspaces = snapshot
        .workspaces
        .into_iter()
        .zip(&app.state.workspaces)
        .enumerate()
        .map(|(workspace_index, (workspace, state))| {
            let mut tokens = workspace.tokens.into_iter().collect::<Vec<_>>();
            tokens.sort_by(|left, right| left.0.cmp(&right.0));
            let workspace_id = workspace.workspace_id;
            let active_tab_id = location
                .and_then(|location| location.active_tab_ids.get(&workspace_id))
                .cloned()
                .unwrap_or(workspace.active_tab_id);
            let active_tab_index =
                app.parse_tab_id(&active_tab_id)
                    .and_then(|(tab_workspace_index, tab_index)| {
                        (tab_workspace_index == workspace_index).then_some(tab_index)
                    });
            protocol::ClientShellWorkspace {
                focused: focused_workspace_id.as_deref() == Some(workspace_id.as_str()),
                workspace_id,
                active_tab_id,
                new_workspace_cwd: app
                    .resolved_new_workspace_cwd_from_tab(workspace_index, active_tab_index)
                    .display()
                    .to_string(),
                number: workspace.number,
                label: workspace.label,
                custom_label: state.custom_name.is_some(),
                branch: state.branch(),
                git_ahead_behind: state.git_ahead_behind(),
                tokens,
                worktree: workspace
                    .worktree
                    .map(|worktree| protocol::ClientShellWorktree {
                        key: worktree.repo_key,
                        label: worktree.repo_name,
                        is_linked_worktree: worktree.is_linked_worktree,
                    }),
                agent_status: workspace.agent_status,
            }
        })
        .collect();
    let tabs = snapshot
        .tabs
        .into_iter()
        .zip(
            app.state
                .workspaces
                .iter()
                .flat_map(|workspace| workspace.tabs.iter()),
        )
        .map(|(tab, state)| {
            let tab_id = tab.tab_id;
            protocol::ClientShellTab {
                focused: focused_tab_id.as_deref() == Some(tab_id.as_str()),
                tab_id,
                workspace_id: tab.workspace_id,
                number: tab.number,
                label: tab.label,
                custom_label: !state.is_auto_named(),
                zoomed: state.zoomed,
                agent_status: tab.agent_status,
            }
        })
        .collect();
    let panes = snapshot
        .panes
        .into_iter()
        .map(|pane| {
            let pane_id = pane.pane_id;
            let focused = focused_pane_id.as_deref() == Some(pane_id.as_str());
            let right_click_passthrough = app
                .parse_pane_id(&pane_id)
                .and_then(|(workspace_index, pane_id)| {
                    app.state
                        .workspaces
                        .get(workspace_index)?
                        .pane_state(pane_id)
                })
                .is_some_and(|pane| pane.right_click_passthrough);
            protocol::ClientShellPane {
                pane_id,
                workspace_id: pane.workspace_id,
                tab_id: pane.tab_id,
                label: pane.label,
                cwd: pane.cwd,
                foreground_cwd: pane.foreground_cwd,
                focused,
                right_click_passthrough,
            }
        })
        .collect();
    let agents = snapshot
        .agents
        .into_iter()
        .map(|agent| {
            let pane_id = agent.pane_id;
            let focused = focused_pane_id.as_deref() == Some(pane_id.as_str());
            let mut state_labels = agent.state_labels.into_iter().collect::<Vec<_>>();
            state_labels.sort_by(|left, right| left.0.cmp(&right.0));
            let mut tokens = agent.tokens.into_iter().collect::<Vec<_>>();
            tokens.sort_by(|left, right| left.0.cmp(&right.0));
            protocol::ClientShellAgent {
                pane_id,
                workspace_id: agent.workspace_id,
                tab_id: agent.tab_id,
                name: agent.name,
                display_agent: agent.display_agent,
                agent: agent.agent,
                title: agent.title,
                terminal_title: agent.terminal_title,
                terminal_title_stripped: agent.terminal_title_stripped,
                agent_status: agent.agent_status,
                state_change_seq: agent.state_change_seq,
                state_labels,
                tokens,
                focused,
            }
        })
        .collect();

    let agent_view_label = app
        .state
        .agent_view_override
        .as_ref()
        .map(|view| view.label.clone().unwrap_or_else(|| "filtered".to_owned()));
    let agent_order = crate::ui::agent_panel_entries_from(&app.state, &app.terminal_runtimes)
        .into_iter()
        .filter_map(|entry| app.public_pane_id(entry.ws_idx, entry.pane_id))
        .collect();

    let zoomed = focused_tab_id
        .as_deref()
        .and_then(|tab_id| app.parse_tab_id(tab_id))
        .and_then(|(workspace_index, tab_index)| {
            app.state
                .workspaces
                .get(workspace_index)?
                .tabs
                .get(tab_index)
        })
        .is_some_and(|tab| tab.zoomed);
    let tab_bar_right = app
        .state
        .tab_bar_right
        .iter()
        .filter_map(|segment| match segment {
            crate::app::state::TabBarStatusSegment::Zoom if zoomed => {
                Some(protocol::ClientShellTabStatusSegment {
                    text: "ZOOM".to_owned(),
                    accent: true,
                })
            }
            crate::app::state::TabBarStatusSegment::Text(Some(text)) if !text.is_empty() => {
                Some(protocol::ClientShellTabStatusSegment {
                    text: text.clone(),
                    accent: false,
                })
            }
            crate::app::state::TabBarStatusSegment::Zoom
            | crate::app::state::TabBarStatusSegment::Text(_) => None,
        })
        .collect();

    let product_announcement = app.state.product_announcement.as_ref().map(|announcement| {
        protocol::ClientShellProductAnnouncement {
            version: announcement.version.clone(),
            id: announcement.id.clone(),
            title: announcement.title.clone(),
            body: announcement.body.clone(),
            preview: announcement.preview,
        }
    });
    let release_notes =
        app.state
            .latest_release_notes
            .as_ref()
            .map(|notes| protocol::ClientShellReleaseNotes {
                version: notes.version.clone(),
                body: notes.body.clone(),
                preview: notes.preview,
            });

    let shell = protocol::ClientShellSnapshot {
        boot_id: boot_id.to_owned(),
        revision,
        config_diagnostic: config_diagnostic.map(str::to_owned),
        product_announcement,
        update_available: app.state.update_available.clone(),
        update_install_command: app.state.update_install_command.clone(),
        server_keybindings_toml: app.client_shell_keybindings_profile().map(str::to_owned),
        latest_release_notes_available: app.state.latest_release_notes_available,
        integration_updates_available: app.state.integration_updates_available(),
        worktree_directory: app.state.worktree_directory.to_string_lossy().into_owned(),
        release_notes,
        focused_workspace_id,
        focused_tab_id,
        focused_pane_id,
        tab_bar_right,
        tab_bar_right_separator: app.state.tab_bar_right_separator.clone(),
        agent_view_label,
        agent_order,
        workspaces,
        tabs,
        panes,
        agents,
        commands: app.client_shell_command_manifest(),
    };
    (shell, completions)
}

fn test_app() -> app::App {
    let (_api_tx, api_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut app = app::App::new(
        &crate::config::Config::default(),
        app::AppPolicy::TEST,
        None,
        api_rx,
        crate::api::EventHub::default(),
    );
    let mut state = app::AppState::test_with_adversarial_identity_state();
    let mut second = crate::workspace::Workspace::test_new("second");
    second.test_add_tab(Some("second-b"));
    state.workspaces.push(second);
    state.ensure_test_terminals();
    for terminal in state.terminals.values_mut() {
        terminal.set_detected_state(
            Some(crate::detect::Agent::Pi),
            crate::detect::AgentState::Idle,
        );
        terminal.last_agent_state_change_seq = Some(3);
        terminal.last_agent_completion_seq = Some(2);
    }
    state.workspaces[0].tabs[0].zoomed = true;
    state.tab_bar_right = vec![
        app::state::TabBarStatusSegment::Zoom,
        app::state::TabBarStatusSegment::Text(Some("status".to_owned())),
        app::state::TabBarStatusSegment::Text(None),
    ];
    state.assert_invariants_for_test();
    app.state = state;
    app
}

fn locations(app: &app::App) -> Vec<Option<ClientShellLocation>> {
    let snapshot = app.session_snapshot();
    let workspace_ids = snapshot
        .workspaces
        .iter()
        .map(|workspace| workspace.workspace_id.clone())
        .collect::<Vec<_>>();
    let tab_ids = snapshot
        .tabs
        .iter()
        .map(|tab| (tab.workspace_id.clone(), tab.tab_id.clone()))
        .collect::<Vec<_>>();
    let tab_of = |workspace: usize, nth: usize| {
        tab_ids
            .iter()
            .filter(|(owner, _)| *owner == workspace_ids[workspace])
            .nth(nth)
            .map(|(_, tab)| tab.clone())
            .expect("tab")
    };
    let location = |focused: Option<&str>, active: &[(&str, String)]| {
        Some(ClientShellLocation {
            focused_workspace_id: focused.map(str::to_owned),
            active_tab_ids: active
                .iter()
                .map(|(workspace, tab)| ((*workspace).to_owned(), tab.clone()))
                .collect(),
        })
    };
    vec![
        None,
        // Every workspace on its second tab, focus on the second workspace.
        location(
            Some(&workspace_ids[1]),
            &[
                (&workspace_ids[0], tab_of(0, 1)),
                (&workspace_ids[1], tab_of(1, 1)),
            ],
        ),
        // A tab id that belongs to another workspace.
        location(
            Some(&workspace_ids[0]),
            &[
                (&workspace_ids[0], tab_of(1, 0)),
                (&workspace_ids[1], tab_of(0, 0)),
            ],
        ),
        // Stale and unknown ids.
        location(
            Some("w_stale"),
            &[
                (&workspace_ids[0], "t_stale".to_owned()),
                ("w_stale", tab_of(1, 0)),
            ],
        ),
        // Focused workspace with no active-tab entry, then no focus at all.
        location(
            Some(&workspace_ids[1]),
            &[(&workspace_ids[0], tab_of(0, 0))],
        ),
        location(None, &[(&workspace_ids[1], tab_of(1, 1))]),
        location(None, &[]),
    ]
}

fn bytes(snapshot: &protocol::ClientShellSnapshot) -> Vec<u8> {
    bincode::serde::encode_to_vec(snapshot, bincode::config::standard()).expect("encode snapshot")
}

fn completion_bytes(completions: &protocol::endpoint::EndpointAgentCompletions) -> Vec<u8> {
    bincode::serde::encode_to_vec(completions, bincode::config::standard())
        .expect("encode completions")
}

#[test]
fn snapshot_matches_the_legacy_builder_for_adversarial_state_and_locations() {
    let app = test_app();
    let mut distinct = std::collections::HashSet::new();
    for (index, location) in locations(&app).into_iter().enumerate() {
        for diagnostic in [None, Some("bad config")] {
            let revision = index as u64 + 7;
            let (new, new_completions) =
                snapshot_with_completions(&app, "boot", revision, diagnostic, location.as_ref());
            let (old, old_completions) = legacy_snapshot_with_completions(
                &app,
                "boot",
                revision,
                diagnostic,
                location.as_ref(),
            );
            assert_eq!(new, old, "location #{index} struct");
            assert_eq!(bytes(&new), bytes(&old), "location #{index} bincode");
            assert_eq!(
                new_completions, old_completions,
                "location #{index} completions"
            );
            assert_eq!(
                completion_bytes(&new_completions),
                completion_bytes(&old_completions)
            );
            distinct.insert(bytes(&new));
        }
    }
    // The locations must actually change the output, or the test proves nothing.
    assert!(distinct.len() >= 6, "locations were not adversarial enough");
}

#[test]
fn snapshot_matches_the_legacy_builder_without_workspaces() {
    let (_api_tx, api_rx) = tokio::sync::mpsc::unbounded_channel();
    let app = app::App::new(
        &crate::config::Config::default(),
        app::AppPolicy::TEST,
        None,
        api_rx,
        crate::api::EventHub::default(),
    );
    let new = snapshot_with_completions(&app, "boot", 1, None, None);
    let old = legacy_snapshot_with_completions(&app, "boot", 1, None, None);
    assert_eq!(new, old);
    assert_eq!(bytes(&new.0), bytes(&old.0));
}
