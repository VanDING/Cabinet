import { useProject } from '../../hooks/useProject';
import { ProjectSwitcher } from '../ProjectSwitcher';

export function ProjectSwitcherWidget() {
  const { projects, current, setProject } = useProject();

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 flex flex-col justify-center items-center">
      <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3">Active Project</h3>
      <ProjectSwitcher projects={projects} current={current} onSwitch={setProject} />
      <span className="text-xs text-gray-400 mt-2">Project ID: {current.id}</span>
    </div>
  );
}
