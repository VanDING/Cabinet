param([string]$path = "E:\Cabinet\apps\desktop\src\components\ChatPanel.tsx")

$content = Get-Content $path -Raw

# Remove old variable declarations
$content = $content -replace 'const textareaRef = useRef<HTMLTextAreaElement>\(null\);\s*', 'const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const handleMenuOpenChange = (menu: string | null) => setMenuOpen(menu);'

# Replace old handler calls 
$content = $content -replace 'const handleAddLocalFile = async \(\) => \{\s*setAddMenuOpen\(false\);\s*', 'const handleAddLocalFile = async () => {'
$content = $content -replace 'const handleAddProjectFile = \(\) => \{\s*setAddMenuOpen\(false\);\s*', 'const handleAddProjectFile = () => {'
$content = $content -replace 'setSkillMenuOpen\(false\);\s*setInput', 'setInput'

# Replace add menu dropdown with DropdownMenu
$addMenuRegex = [regex]::Escape('<div className="relative">') + '\s*' + [regex]::Escape('<button') + '.*?' + [regex]::Escape('Add') + '.*?' + [regex]::Escape('</button>') + '\s*(.*?)\s*</div>'
# Too complex for regex, let me take a different approach

Set-Content $path $content
Write-Host "Partial fix applied"
