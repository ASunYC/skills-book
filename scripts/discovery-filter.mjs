export const DISCOVERY_VERIFICATION = {
  rootSkillEntry: "root-skill-entry",
  metadataSkillSignal: "metadata-skill-signal",
  codeSearchSkillEntry: "code-search-skill-entry",
};

const ACCEPTED_DISCOVERY_VERIFICATIONS = new Set(Object.values(DISCOVERY_VERIFICATION));

function lower(value) {
  return String(value || "").toLowerCase();
}

export function repoHasMetadataSkillSignal(repo) {
  const description = lower(repo?.description);
  const name = lower(repo?.name);
  const fullName = lower(repo?.full_name);
  const topics = (repo?.topics || []).map(lower);

  return (
    name.includes("skill") ||
    fullName.includes("skill") ||
    description.includes("skill") ||
    topics.some((topic) => topic.includes("skill")) ||
    description.includes("agent.md") ||
    name.includes("opencli") ||
    fullName.includes("opencli") ||
    description.includes("opencli")
  );
}

export function skillHasMetadataSkillSignal(skill) {
  const topics = Array.isArray(skill?.topics) ? skill.topics : [];
  const text = [
    skill?.owner,
    skill?.name,
    skill?.display_name,
    skill?.description,
    skill?.category,
    skill?.github_repo,
    skill?.url,
    ...topics,
  ].map(lower).join(" ");

  return text.includes("skill") || text.includes("agent.md") || text.includes("opencli");
}

export function isAcceptedDiscoveredSkill(skill) {
  const source = lower(skill?.source);
  if (!source.startsWith("discover:")) return true;
  if (ACCEPTED_DISCOVERY_VERIFICATIONS.has(String(skill?.discovery_verified || ""))) return true;
  if (source === "discover:code") return true;
  return skillHasMetadataSkillSignal(skill);
}

export function filterDiscoveredSkills(skills) {
  return Object.fromEntries(
    Object.entries(skills || {}).filter(([, skill]) => isAcceptedDiscoveredSkill(skill)),
  );
}
