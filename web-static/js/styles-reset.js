document.addEventListener('DOMContentLoaded', (event) => {
    const html = document.getElementsByTagName('html')[0]
    const defautlStyles = document.getElementById('_defaultStyles')

    html.removeAttribute('style')
    defautlStyles.remove()
})