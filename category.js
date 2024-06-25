document.addEventListener('DOMContentLoaded', function() {
  // Function to get the query parameter value
  function getQueryParam(param) {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get(param);
  }

  // Define content for each category
  const categoryContent = {
      category1: {
          title: "Category 1",
          content: "This is the content for Category 1."
      },
      category2: {
          title: "Category 2",
          content: "This is the content for Category 2."
      },
      category3: {
          title: "Category 3",
          content: "This is the content for Category 3."
      }
      // Add more categories as needed
  };

  // Get the category from the URL
  const category = getQueryParam('category');

  // Set the content based on the category
  if (category && categoryContent[category]) {
      document.getElementById('category-title').innerText = categoryContent[category].title;
      document.getElementById('category-content').innerText = categoryContent[category].content;
  } else {
      // Default content if category not found or not specified
      document.getElementById('category-title').innerText = "Unknown Category";
      document.getElementById('category-content').innerText = "The category you are looking for does not exist.";
  }
});
