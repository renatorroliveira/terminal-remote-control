//! `trcd core`: the per-user supervisor. It speaks the app protocol, keeps the session registry and starts one
//! holder process per session.

pub mod account;
pub mod adopt;
pub mod launch;
pub mod process;
pub mod profiles;
pub mod registry;
pub mod service;
