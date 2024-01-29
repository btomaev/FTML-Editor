let tip;
let previewPending = false;

async function showPreviewPopup(event) {
    if (tip) return;
    const element = event.target;

    previewPending = true;

    const response = await fetch(element.href, {
        method: 'GET'
    });

    if (!previewPending) return;

    tip = document.createElement('div');
    tip.innerHTML = (await response.text())
    tip.style = "position: absolute;";
    element.appendChild(tip);
}

async function hidePreviewPopup(event) {
    previewPending = false;
    if (tip) tip.remove();
    tip = null;
    
}

function attachObserver() {
    const targetNode = document.body;
    console.log(targetNode);

    if (!targetNode) {
        setTimeout(attachObserver, 500);
        return;
    }

    const links = document.getElementsByTagName("a");

    for (var i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.hasAttribute("href")) {
            console.log(link);
            link.addEventListener("mouseover", showPreviewPopup, false);
            link.addEventListener("mouseleave", hidePreviewPopup, false);
        }
    }
}

setTimeout(attachObserver, 100);